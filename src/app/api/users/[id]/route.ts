import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User, { IUser, UserStatus } from "@/models/User"; // Import IUser and UserStatus
// --- Import UserSex type along with IUserProfile ---
import UserProfile, { IUserProfile, UserSex } from "@/models/UserProfile";
// Remove requireRole if using getToken for all checks
// import { requireRole } from "@/middleware/authMiddleware";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose"; // Import mongoose

// Define allowed roles and statuses for validation
const ALLOWED_ROLES: IUser['role'][] = ['user', 'admin']; // Adjust as needed
const ALLOWED_STATUSES: UserStatus[] = ['pending', 'approved', 'rejected'];
// --- Define allowed sex values for validation ---
const ALLOWED_SEX_VALUES: UserSex[] = ['Male', 'Female'];

type RouteContext = {
    params: Promise<{ id: string }>;
};

// --- GET user by ID ---
export async function GET(req: NextRequest, { params }: RouteContext) {
    await connectDB();

    // Use getToken for consistency
    const token = await getToken({ req, secret: process.env.SESSION_SECRET });

    // Decide who can GET: Admin only? Or user for their own ID?
    // Option 1: Admin only
    if (!token || token.role !== 'admin') {
       return NextResponse.json({ message: 'Unauthorized: Admin role required' }, { status: 403 });
    }

    try {
        const { id } = await params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ message: "Invalid user ID format" }, { status: 400 });
        }

        // Fetch user and populate profile (including sex)
        const user = await User.findById(id)
            .select("-password")
            .populate<{ profile: IUserProfile }>({ // Use IUserProfile type hint
                path: "profile",
                model: UserProfile,
                // Explicitly select fields needed by the frontend edit page
                select: 'firstName lastName sex'
            })
            .lean();

        if (!user) {
            return NextResponse.json({ message: "User not found" }, { status: 404 });
        }

        // Return user object which now includes the populated profile
        return NextResponse.json({ user }, { status: 200 });

    } catch (error: any) {
        console.error("[API GET /users/:id] Error fetching user:", error);
        return NextResponse.json({ message: "Server error while fetching user", error: error.message }, { status: 500 });
    }
}


// --- PUT User Profile by ID (User self-update OR Admin update) ---
// This handler remains unchanged as it correctly handles profile fields including 'sex'
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    await connectDB();

    const token = await getToken({ req, secret: process.env.SESSION_SECRET });
    if (!token) {
      return NextResponse.json({ error: "Unauthorized: Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    console.log(`[API PUT /users/:id] Received body for user ${id}:`, JSON.stringify(body)); // Log received body

     // Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ message: "Invalid user ID format" }, { status: 400 });
    }

    // --- Prepare allowed fields for profile update ---
    // Add 'profilePictureUrl' to the allowed keys
    type AllowedProfileUpdateKeys = keyof Pick<IUserProfile, 'firstName' | 'lastName' | 'employeeNumber' | 'workPosition' | 'team' | 'birthdate' | 'sex' | 'profilePictureUrl'>;
    const allowedProfileUpdates: Partial<Pick<IUserProfile, AllowedProfileUpdateKeys>> = {};
    // Add 'profilePictureUrl' to the fields to check
    const profileFields: AllowedProfileUpdateKeys[] = ['firstName', 'lastName', 'employeeNumber', 'workPosition', 'team', 'birthdate', 'sex', 'profilePictureUrl'];

    profileFields.forEach(field => {
        if (body.hasOwnProperty(field)) {
            if (field === 'sex') {
                if (!ALLOWED_SEX_VALUES.includes(body[field])) {
                    // Return 400 for invalid sex value in PUT as well
                    return NextResponse.json({ message: `Invalid sex value. Allowed: ${ALLOWED_SEX_VALUES.join(', ')}` }, { status: 400 });
                }
            }
            // Add simple validation for profilePictureUrl if needed (e.g., check if it's a string and maybe a basic URL pattern)
            // if (field === 'profilePictureUrl' && typeof body[field] !== 'string') { /* handle error */ }

            allowedProfileUpdates[field] = body[field];
        }
    });

    console.log(`[API PUT /users/:id] Prepared profile updates for user ${id}:`, JSON.stringify(allowedProfileUpdates)); // Log updates being prepared
    if (Object.keys(allowedProfileUpdates).length === 0) {
        return NextResponse.json({ message: "No valid profile fields provided for update." }, { status: 400 });
    }

    // Allow admins to update any profile
    if (token.role === "admin") {
      console.log(`[API PUT /users/:id] Admin ${token.email} updating profile for user ${id}`);
      console.log(`[API PUT /users/:id] Attempting findOneAndUpdate with data:`, JSON.stringify(allowedProfileUpdates)); // Log before DB call
      const updatedProfile = await UserProfile.findOneAndUpdate(
          { user: id },
          { $set: allowedProfileUpdates },
          { new: true, upsert: false, runValidators: true }
      ).lean();

      if (!updatedProfile) {
         const userExists = await User.findById(id).countDocuments() > 0;
         return NextResponse.json({ message: userExists ? "Profile not found for this user" : "User not found" }, { status: 404 });
      }
      console.log(`[API PUT /users/:id] Admin update successful for user ${id}. Result:`, JSON.stringify(updatedProfile)); // Log success
      return NextResponse.json({ message: "Profile updated successfully by admin!", data: updatedProfile });
    }

    // Allow users to only update their own profile
    if (!token.sub || token.sub !== id) {
      console.warn(`[API PUT /users/:id] Forbidden attempt by user ${token.email} (sub: ${token.sub}) to update profile for user ${id}`);
      return NextResponse.json({ error: "Forbidden: You can only edit your own profile" }, { status: 403 });
    }

    console.log(`[API PUT /users/:id] User ${token.email} updating own profile`);
    console.log(`[API PUT /users/:id] Attempting findOneAndUpdate with data:`, JSON.stringify(allowedProfileUpdates)); // Log before DB call
    const updatedProfile = await UserProfile.findOneAndUpdate(
        { user: token.sub },
        { $set: allowedProfileUpdates },
        { new: true, upsert: false, runValidators: true }
    ).lean();

    if (!updatedProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    console.log(`[API PUT /users/:id] Self-update successful for user ${id}. Result:`, JSON.stringify(updatedProfile)); // Log success

    return NextResponse.json({ message: "Profile updated successfully!", data: updatedProfile });

  } catch (error: any) {
    console.error("[API PUT /users/:id] Error updating profile:", error);
     if (error instanceof mongoose.Error.ValidationError) {
        return NextResponse.json({ message: "Validation failed", errors: error.errors }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
         return NextResponse.json({ message: 'Invalid JSON in request body.' }, { status: 400 });
    }
    return NextResponse.json({ error: "Server error while updating profile" }, { status: 500 });
  }
}


// --- PATCH User Details (Role, Status, Sex) by ID (Admin only) ---
export async function PATCH(req: NextRequest, { params }: RouteContext) {
    await connectDB();

    // 1. Authorization Check (Admin Only)
    const token = await getToken({ req, secret: process.env.SESSION_SECRET });
    if (!token || token.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized: Admin role required' }, { status: 403 });
    }

    try {
        const { id } = await params;
        const body = await req.json();

        // 2. Validate ID format
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json({ message: "Invalid user ID format" }, { status: 400 });
        }

        // 3. Prepare update objects and validate
        const userUpdateFields: Partial<Pick<IUser, 'role' | 'status'>> = {};
        const profileUpdateFields: Partial<Pick<IUserProfile, 'sex'>> = {}; // Separate update for profile

        let hasUserUpdates = false;
        let hasProfileUpdates = false;

        // Validate and prepare User updates
        if (body.hasOwnProperty('role')) {
            if (!ALLOWED_ROLES.includes(body.role)) {
                return NextResponse.json({ message: `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}` }, { status: 400 });
            }
            userUpdateFields.role = body.role;
            hasUserUpdates = true;
        }

        if (body.hasOwnProperty('status')) {
             if (!ALLOWED_STATUSES.includes(body.status)) {
                return NextResponse.json({ message: `Invalid status. Allowed statuses: ${ALLOWED_STATUSES.join(', ')}` }, { status: 400 });
            }
            userUpdateFields.status = body.status;
            hasUserUpdates = true;
        }

        // Validate and prepare Profile updates (only 'sex' in PATCH)
        if (body.hasOwnProperty('sex')) {
            if (!ALLOWED_SEX_VALUES.includes(body.sex)) {
                return NextResponse.json({ message: `Invalid sex value. Allowed: ${ALLOWED_SEX_VALUES.join(', ')}` }, { status: 400 });
            }
            profileUpdateFields.sex = body.sex;
            hasProfileUpdates = true;
        }

        // Check if any valid fields were provided
        if (!hasUserUpdates && !hasProfileUpdates) {
             return NextResponse.json({ message: "No valid fields (role, status, sex) provided for update." }, { status: 400 });
        }

        // 4. Perform Updates
        let updatedUser: IUser | null = null;
        let updatedProfile: IUserProfile | null = null;

        // --- Update User if needed ---
        if (hasUserUpdates) {
            updatedUser = await User.findByIdAndUpdate(
                id,
                { $set: userUpdateFields },
                { new: true, runValidators: true }
            ).select('-password').lean(); // Exclude password

            if (!updatedUser) {
                // If user update fails, no point proceeding
                return NextResponse.json({ message: "User not found for update." }, { status: 404 });
            }
            console.log(`[API PATCH /users/:id] Admin ${token.email} updated User details for user ${id}:`, userUpdateFields);
        }

        // --- Update UserProfile if needed ---
        if (hasProfileUpdates) {
            updatedProfile = await UserProfile.findOneAndUpdate(
                { user: id }, // Find profile by user ID
                { $set: profileUpdateFields },
                { new: true, runValidators: true }
            ).lean();

            if (!updatedProfile) {
                // Log a warning but don't necessarily fail if profile wasn't found but user was updated
                console.warn(`[API PATCH /users/:id] User profile not found for user ${id} during sex update.`);
                // Optionally return an error if profile MUST exist:
                // return NextResponse.json({ message: "User profile not found for update." }, { status: 404 });
            } else {
                 console.log(`[API PATCH /users/:id] Admin ${token.email} updated UserProfile details for user ${id}:`, profileUpdateFields);
            }
        }

        // 5. Fetch the final state of the user with populated profile to return
        const finalUserData = await User.findById(id)
            .select("-password")
            .populate<{ profile: IUserProfile }>({ path: "profile", model: UserProfile, select: 'firstName lastName sex' })
            .lean();

        if (!finalUserData) {
             // Should not happen if user update succeeded, but good safety check
             return NextResponse.json({ message: "Failed to retrieve updated user data." }, { status: 500 });
        }

        // 6. Return Success Response
        return NextResponse.json({ message: "User details updated successfully!", user: finalUserData }, { status: 200 });

    } catch (error: any) {
        console.error("[API PATCH /users/:id] Error updating user details:", error);
         if (error instanceof mongoose.Error.ValidationError) {
            // Distinguish between User and UserProfile validation errors if needed
            return NextResponse.json({ message: "Validation failed", errors: error.errors }, { status: 400 });
        }
        if (error instanceof SyntaxError) {
             return NextResponse.json({ message: 'Invalid JSON in request body.' }, { status: 400 });
        }
        return NextResponse.json({ message: "Server error while updating user details", error: error.message }, { status: 500 });
    }
}


// --- DELETE user by ID (Admin only) ---
// This handler remains unchanged
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  await connectDB();

  const token = await getToken({ req, secret: process.env.SESSION_SECRET });
  if (!token || token.role !== 'admin') {
    return NextResponse.json({ message: 'Unauthorized: Admin role required' }, { status: 403 });
  }

  try {
    const { id } = await params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ message: "Invalid user ID format" }, { status: 400 });
    }

    // Delete user profile first
    await UserProfile.findOneAndDelete({ user: id });

    // Delete user account
    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
        return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    console.log(`[API DELETE /users/:id] Admin ${token.email} deleted user ${id}`);
    return NextResponse.json({ message: "User deleted successfully!" }, { status: 200 });

  } catch (error: any) {
    console.error("[API DELETE /users/:id] Error deleting user:", error);
    return NextResponse.json({ message: "Server error while deleting user", error: error.message }, { status: 500 });
  }
}
