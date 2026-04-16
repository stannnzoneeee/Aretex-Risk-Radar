// src/auth.ts
import NextAuth, { AuthOptions, User as NextAuthUser } from "next-auth";
import { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
// Correct adapter import for NextAuth v4/v5 with MongoDB native driver
import { MongoDBAdapter } from "@next-auth/mongodb-adapter";
import bcrypt from "bcryptjs";
import connectDB from "@/lib/mongodb";
import User, { IUser, UserStatus } from "@/models/User"; // Import IUser interface
import UserProfile from "@/models/UserProfile"; // Ensure UserProfile model is imported
import mongoose from "mongoose"; // Import mongoose itself
import { MongoClient } from "mongodb"; // Import MongoClient
import { getAuthSecret } from "@/lib/authSecret";

// --- Type Extensions ---
// Add profileComplete and make profile/name optional
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      role: "admin" | "user";
      profile?: string; // Profile might not exist initially
      status: UserStatus;
      name?: string; // Name might not exist initially
      profileComplete: boolean; // Added profileComplete flag
      profilePictureUrl?: string | null; // <-- Add profile picture URL
    };
  }

  // Extend the default NextAuth User type
  // Note: Renamed to avoid conflict with the imported User model
  interface AdapterUser extends NextAuthUser {
    // id, email, name, image are part of NextAuthUser
    role: "admin" | "user";
    profile?: string; // Profile might not exist initially
    status: UserStatus;
    profileComplete: boolean; // Added profileComplete flag
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email: string;
    role: "admin" | "user";
    profile?: string; // Profile might not exist initially
    status: UserStatus;
    name?: string; // Name might not exist initially
    profileComplete: boolean; // Added profileComplete flag
    profilePictureUrl?: string | null; // <-- Add profile picture URL
    // 'sub' is standard in JWT for user ID, ensure it's string
    sub?: string;
  }
}
// --- End Type Extensions ---


// Helper function to get the MongoClient promise
async function getMongoClientPromise(): Promise<MongoClient> {
  await connectDB(); // Ensure connection is established
  // Mongoose connection object might have the client directly or within db object
  const client = mongoose.connection.getClient();
  if (!client) {
    throw new Error("Failed to get MongoDB client from Mongoose connection.");
  }
  // The adapter expects a MongoClient instance
  return client as unknown as MongoClient;
}


export const authOptions: AuthOptions = {
  // --- Configure the MongoDB Adapter ---
  // Pass the promise that resolves to the MongoClient
  adapter: MongoDBAdapter(getMongoClientPromise()),

  providers: [
    // --- Google Provider Configuration ---
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
    // --- Credentials Provider (Existing - Modified Authorize) ---
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials): Promise<any> { // Using 'any' for simplicity, refine if possible
        if (!credentials?.email || !credentials?.password) {
          console.error("[Auth] Authorize attempt missing credentials");
          return null;
        }

        await connectDB();

        try {
          // Fetch user with necessary fields for validation AND session/token
          const user = await User.findOne({ email: credentials.email })
            .select("+password +status +profile +role +profileComplete +name") // Select all needed fields
            .lean();

          if (!user) {
            console.log(`[Auth] Authorize failed: No user found for email ${credentials.email}`);
            return null;
          }

          if (!user.password) {
            console.warn(`[Auth] Authorize failed: User ${credentials.email} exists but has no password (likely OAuth).`);
            // Throw specific error for frontend to handle OAuthAccountNotLinked scenario
            throw new Error("OAuthAccountNotLinked");
          }

          const isValidPassword = await bcrypt.compare(
            credentials.password,
            user.password
          );
          if (!isValidPassword) {
            console.log(`[Auth] Authorize failed: Invalid password for email ${credentials.email}`);
            // Throw specific error for invalid credentials
             throw new Error("InvalidCredentials");
          }

          // NOTE: Status check moved to signIn callback for consistency across providers

          console.log(`[Auth] Authorize successful for email ${credentials.email}`);

          // --- Logic to determine the best name ---
          let finalName = user.name; // Start with name from User model
          if ((!finalName || finalName.trim() === '') && user.profile && mongoose.Types.ObjectId.isValid(user.profile.toString())) {
            console.log(`[Auth] Authorize: User.name missing, attempting to fetch from UserProfile ID: ${user.profile.toString()}`);
            try {
              const userProfile = await UserProfile.findById(user.profile).select('firstName lastName profilePictureUrl').lean(); // <-- Select URL here too
              if (userProfile && userProfile.firstName) { // Only require firstName now
                finalName = userProfile.firstName.trim(); // Use only firstName
                console.log(`[Auth] Authorize: Constructed name from UserProfile: ${finalName}`);
              } else {
                 console.warn(`[Auth] Authorize: UserProfile found but missing name fields for profile ID: ${user.profile.toString()}`);
              }
            } catch (profileError) {
               console.error(`[Auth] Authorize: Error fetching UserProfile for ID ${user.profile.toString()}:`, profileError);
            }
          }
          // --- End name logic ---

          // Return the full user object expected by NextAuth callbacks
          return {
            id: user._id.toString(), // This is the MongoDB ObjectId string
            email: user.email,
            role: user.role,
            profile: user.profile?.toString(),
            status: user.status,
            name: finalName, // Use the determined name
            profileComplete: user.profileComplete ?? false,
            // profilePictureUrl will be added in JWT callback
            // image: user.image, // Include if you add image to your User model
          };

        } catch (error: any) {
          // Re-throw specific errors for frontend handling
          if (error.message === "OAuthAccountNotLinked" || error.message === "InvalidCredentials") {
            throw error;
          }
          // Handle other unexpected errors
          console.error("[Auth] Error during authorization:", error.message || error);
          throw new Error("Authentication error occurred."); // Generic error for others
        }
      },
    }),
  ],
  pages: {
    signIn: "/", // Your main page acts as the sign-in page
    error: "/",  // <<< ADD THIS LINE: Redirect errors back to the sign-in page
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 1 day
  },
  callbacks: {
    // --- signIn Callback ---
    // Central place to check status *after* authentication succeeds (Credentials or OAuth)
    async signIn({ user, account, profile, email, credentials }) {
      console.log(`[Auth] signIn callback triggered for user: ${user.email}, Provider: ${account?.provider ?? 'credentials'}`);

      // The user.id *should* be the MongoDB ObjectId string from the adapter or authorize
      // For initial Google sign-in via adapter, user.id might be the Google ID temporarily.
      let userId = user.id;
      let userEmail = user.email; // Use email from the user object passed in

      if (!userId && !userEmail) {
          console.error("[Auth] signIn callback: No user ID or email provided in user object.");
          return false; // Prevent sign-in
      }

      await connectDB();
      let dbUser: Pick<IUser, 'status'> | null = null; // Use Pick for specific fields

      try {
          // Strategy:
          // 1. If ID is a valid ObjectId, try finding by ID.
          // 2. If not valid ObjectId (likely Google ID) OR findById fails, try finding by email.
          if (userId && mongoose.Types.ObjectId.isValid(userId)) {
              console.log(`[Auth] signIn: Attempting to find user by valid ObjectId: ${userId}`);
              dbUser = await User.findById(userId).select('status').lean();
          }

          // If not found by ID or ID wasn't valid ObjectId, try email (especially for initial OAuth link)
          if (!dbUser && userEmail) {
              console.log(`[Auth] signIn: User not found by ID or ID invalid. Attempting to find user by email: ${userEmail}`);
              dbUser = await User.findOne({ email: userEmail }).select('status').lean();
          }

          // If still no user found after checking ID and email
          if (!dbUser) {
              // This case might happen during the very first sign-up via Google before the adapter creates the user.
              // It's generally safe to allow this flow to continue, as the adapter will handle creation.
              // If a user *should* exist but isn't found, it indicates a different problem.
              console.warn(`[Auth] signIn callback: User not found in DB by ID ('${userId}') or email ('${userEmail}'). Allowing flow to continue (likely first OAuth sign-up).`);
              return true; // Allow flow to continue (adapter will create user if needed)
          }

          // --- Centralized Status Check ---
          // *** ADDED 'pending' CHECK ***
          if (dbUser.status === 'pending') {
              console.log(`[Auth] signIn blocked: User ${userEmail} status is 'pending'.`);
              // Throw a specific error code for the frontend
              throw new Error("AccountPending");
          }
          // *** END ADDED CHECK ***

          if (dbUser.status === 'rejected') {
              console.log(`[Auth] signIn blocked: User ${userEmail} status is 'rejected'.`);
              // Throw a specific error code for the frontend
              throw new Error("AccountRejected");
          }

          // If user found and status is approved
          console.log(`[Auth] signIn allowed for user: ${userEmail} (Status: ${dbUser.status})`);
          return true; // Allow session creation

      } catch (error: any) {
          // Handle specific errors thrown above
          // *** ADDED "AccountPending" TO RETHROWN ERRORS ***
          if (error.message === "AccountPending" || error.message === "AccountRejected" || error.message === "Account not approved") {
              throw error; // Rethrow specific errors for frontend handling via URL params
          }
          // Handle potential CastError if findById was called with an invalid format ID (less likely now with the email fallback)
          if (error.name === 'CastError' && error.path === '_id') {
               console.warn(`[Auth] signIn callback: CastError finding user by ID ${userId}. Allowing flow to continue.`);
               return true; // Allow flow to continue
          }

          // Handle other unexpected errors
          console.error(`[Auth] signIn callback: Unexpected error during DB lookup or status check for user ${userEmail}:`, error);
          return false; // Prevent sign-in on other errors
      }
  },

    // --- jwt Callback ---
    // Populates the JWT token. Called on sign-in and potentially on session access.
    async jwt({ token, user, account, profile, trigger, session }) {
      await connectDB(); // Ensure DB connection for potential fetches

      // Determine the user ID to use for fetching data.
      let userIdToFetch: string | undefined = user?.id || token?.sub;

      // --- Validate the user ID format before fetching ---
      if (userIdToFetch && !mongoose.Types.ObjectId.isValid(userIdToFetch)) {
          console.warn(`[Auth] jwt callback: Invalid user ID format found: ${userIdToFetch}. Attempting fallback.`);
          // Fallback: If it's initial Google sign-in and ID is invalid, try finding user by email.
          // Use token.email as fallback if user object isn't present (e.g., on session update)
          const emailForFallback = user?.email || token?.email;
          if (emailForFallback && account?.provider === 'google' && (!user || !mongoose.Types.ObjectId.isValid(user.id))) {
              try {
                  const userByEmail = await User.findOne({ email: emailForFallback }).select('_id').lean();
                  if (userByEmail) {
                      console.log(`[Auth] jwt callback: Fallback successful. Found user by email (${emailForFallback}), using DB ID: ${userByEmail._id.toString()}`);
                      userIdToFetch = userByEmail._id.toString(); // Correct the ID
                  } else {
                      console.error(`[Auth] jwt callback: Fallback failed. Invalid ID (${userIdToFetch}) and could not find user by email: ${emailForFallback}`);
                      userIdToFetch = undefined; // Cannot proceed
                  }
              } catch (dbError) {
                  console.error(`[Auth] jwt callback: Error during email fallback lookup for ${emailForFallback}:`, dbError);
                  userIdToFetch = undefined;
              }
          } else {
               console.error(`[Auth] jwt callback: Invalid user ID format (${userIdToFetch}) and cannot resolve via fallback.`);
               userIdToFetch = undefined; // Cannot proceed
          }
      }
      // --- End Validation ---


      // Proceed only if we have a valid user ID
      if (userIdToFetch) {
          // --- Initial Sign-in or Session Update Trigger ---
          if (user || trigger === "update") {
              if (user) console.log(`[Auth] jwt callback: Initial sign-in. Populating token using ID: ${userIdToFetch}.`);
              else console.log(`[Auth] jwt callback: Update trigger. Refreshing token data using ID: ${userIdToFetch}.`);

              try {
                  // Fetch user including name and profile link
                  const dbUser = await User.findById(userIdToFetch).select('email role status profileComplete name profile').lean();
                  if (dbUser) {
                      // --- Logic to determine the best name ---
                      let finalName = dbUser.name; // Start with name from User model
                      let profilePictureUrlFromProfile: string | undefined | null = undefined; // Variable to hold fetched URL
                      if ((!finalName || finalName.trim() === '') && dbUser.profile && mongoose.Types.ObjectId.isValid(dbUser.profile.toString())) {
                         console.log(`[Auth] jwt: User.name missing, attempting fetch from UserProfile ID: ${dbUser.profile.toString()}`);
                         try {
                            // Fetch name and picture URL together
                            const userProfile = await UserProfile.findById(dbUser.profile).select('firstName lastName profilePictureUrl').lean(); // <-- Select URL
                            if (userProfile && userProfile.firstName) { // Only require firstName now
                               finalName = userProfile.firstName.trim(); // Use only firstName
                               console.log(`[Auth] jwt: Constructed name from UserProfile: ${finalName}`);
                            } else {
                               console.warn(`[Auth] jwt: UserProfile found but missing name fields for profile ID: ${dbUser.profile.toString()}`);
                            }
                            // Store fetched profile picture URL
                            profilePictureUrlFromProfile = userProfile?.profilePictureUrl;
                            if (userProfile?.profilePictureUrl) {
                                console.log(`[Auth] jwt: Fetched profilePictureUrl during name construction: ${profilePictureUrlFromProfile}`);
                            }
                         } catch (profileError) {
                            console.error(`[Auth] jwt: Error fetching UserProfile for ID ${dbUser.profile.toString()}:`, profileError);
                         }
                      }
                      // --- Always fetch profile picture URL on update trigger if profile exists ---
                      // This ensures the picture updates even if the name didn't need construction.
                      else if (trigger === "update" && dbUser.profile && mongoose.Types.ObjectId.isValid(dbUser.profile.toString())) {
                          console.log(`[Auth] jwt: Update trigger - fetching UserProfile for picture URL. Profile ID: ${dbUser.profile.toString()}`);
                          const userProfilePicOnly = await UserProfile.findById(dbUser.profile).select('profilePictureUrl').lean();
                          profilePictureUrlFromProfile = userProfilePicOnly?.profilePictureUrl;
                          if (profilePictureUrlFromProfile) console.log(`[Auth] jwt: Fetched profilePictureUrl separately during update: ${profilePictureUrlFromProfile}`);
                          else console.log(`[Auth] jwt: UserProfile found but no picture URL during separate fetch.`);
                      }
                      // --- End name logic ---

                      // Populate token
                      token.id = dbUser._id.toString();
                      token.email = dbUser.email;
                      token.role = dbUser.role;
                      token.status = dbUser.status;
                      token.profileComplete = dbUser.profileComplete ?? false;
                      token.name = finalName; // Use the determined name
                      token.profile = dbUser.profile?.toString();
                      token.profilePictureUrl = profilePictureUrlFromProfile; // Assign the fetched URL (or null/undefined)
                      token.sub = dbUser._id.toString(); // Ensure token.sub is the correct DB ID string
                      console.log(`[Auth] jwt callback: Token populated/refreshed from DB:`, { id: token.id, name: token.name, role: token.role, status: token.status, profileComplete: token.profileComplete, hasPicUrl: !!token.profilePictureUrl }); // <-- Log URL presence

                  } else {
                      console.error(`[Auth] jwt callback: Could not find user ${userIdToFetch} in DB during population/refresh. Returning original token.`);
                      // If user is deleted mid-session, prevent further use of token
                      return { id: '', email: '', role: 'user', status: 'pending', profileComplete: false }; // Return a default JWT object to invalidate
                  }
              } catch (error) {
                  console.error(`[Auth] jwt callback: Error fetching user ${userIdToFetch} from DB:`, error);
                  return token; // Return original token on DB error
              }
          }
          // --- Subsequent Requests ---
          // (No changes needed here for this request)
      } else {
          console.error("[Auth] jwt callback: Cannot proceed without a valid user ID. Returning original token.");
          // If ID is invalid, potentially invalidate token
          return { id: '', email: '', role: 'user', status: 'pending', profileComplete: false, name: '', profile: '' }; // Return a default JWT object to invalidate
      }

      return token; // Return the populated/refreshed token
    },


    // --- session Callback ---
    // Makes data from the JWT available to the client-side `useSession` hook.
    async session({ session, token }) {
      // Assign properties from the token to session.user
      // Ensure all properties exist on the token before assigning
      if (token && token.id && session.user) { // Check if token has essential data (like id)
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.status = token.status;
        session.user.profileComplete = token.profileComplete ?? false; // Ensure boolean
        session.user.name = token.name; // Assign name from token
        session.user.profile = token.profile;
        session.user.profilePictureUrl = token.profilePictureUrl; // <-- Pass URL to session
        session.user.email = token.email || ''; // Ensure email exists
      } else {
          // If token is invalid or missing essential data, invalidate the session
          console.warn("[Auth] session callback: Received invalid or incomplete token. Returning null session.");
          return null as any; // Return null to indicate no active session
      }
      // console.log("[Auth] session callback, returning session:", JSON.stringify(session, null, 2)); // Debug log
      return session; // Return the session object for the client
    },
  },
  secret: getAuthSecret(), // Supports AUTH_SECRET, NEXTAUTH_SECRET, or SESSION_SECRET
  // debug: process.env.NODE_ENV === 'development', // Optional: Enable for more logs
};

// Export handlers and auth functions
export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);

// Helper function to trigger session update (call this from your API route after success)
import { getServerSession } from "next-auth/next";

export async function updateSession(req: Request) {
    const session = await getServerSession(authOptions);
    if (session) {
        // This primarily signals the JWT callback's "update" trigger.
        console.log("[Auth Helper] Triggering session update (flagging for refresh).");
        // In NextAuth v5+, direct manipulation is discouraged. Rely on the JWT update flow.
    }
}
