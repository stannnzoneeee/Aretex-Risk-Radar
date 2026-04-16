// src/app/api/users/[id]/status/route.ts

import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User, { UserStatus } from "@/models/User"; // Import UserStatus type
import { getToken } from "next-auth/jwt";
import { sendStatusUpdateEmail } from "@/lib/email"; // Import the email function
import mongoose from "mongoose";
import UserProfile from "@/models/UserProfile"; // Import UserProfile to potentially get name

// Define the expected structure of the request body
interface UpdateStatusRequestBody {
  status: UserStatus; // Expect 'approved' or 'rejected'
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(
  req: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  let id = "unknown";

  try {
    // 1. Validate userId format (using params.id)
    ({ id } = await params);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Invalid user ID format." }, { status: 400 });
    }

    // 2. Authentication and Authorization Check (Admin Only)
    const token = await getToken({ req, secret: process.env.SESSION_SECRET });
    if (!token) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }
    if (token.role !== "admin") {
      return NextResponse.json({ message: "Forbidden: Admin role required." }, { status: 403 });
    }
    // Prevent admin from changing their own status via this endpoint
    if (token.id === id) {
        return NextResponse.json({ message: "Admins cannot change their own status via this endpoint." }, { status: 403 });
    }

    // 3. Parse and Validate Request Body
    let body: UpdateStatusRequestBody;
    try {
      body = await req.json();
    } catch (parseError) {
      return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
    }

    const { status } = body;
    // Validate the received status
    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ message: "Invalid status provided. Must be 'approved' or 'rejected'." }, { status: 400 });
    }

    // 4. Connect to Database
    await connectDB();

    // 5. Find and Update User Status (using params.id)
    const updatedUser = await User.findByIdAndUpdate(
      id, // Use 'id' from params
      { $set: { status: status } },
      { new: true, runValidators: true } // Return the updated document and run schema validators
    )
    .select('email status role profile name') // Select fields needed for response and email
    .populate<{ profile: { firstName: string } }>('profile', 'firstName'); // Populate profile to get first name

    // 6. Handle User Not Found
    if (!updatedUser) {
      return NextResponse.json({ message: "User not found." }, { status: 404 });
    }

    // 7. Send Status Update Email
    try {
      // Determine the name to use (from User.name or profile.firstName)
      const userName = updatedUser.name || updatedUser.profile?.firstName;
      await sendStatusUpdateEmail(updatedUser.email, userName, status);
    } catch (emailError) {
      console.error(`Failed to send ${status} status update email to ${updatedUser.email}:`, emailError);
      // Log the error but don't fail the API request
    }

    // 8. Return Success Response
    console.log(`Admin ${token.email} updated user ${updatedUser.email} status to ${status}`);
    return NextResponse.json(
        { message: `User status successfully updated to ${status}.`, user: updatedUser },
        { status: 200 }
    );

  } catch (error: any) {
    console.error(`API Error updating user status for ID ${id}:`, error);

    if (error instanceof mongoose.Error.ValidationError) {
      const messages = Object.values(error.errors).map(e => e.message);
      return NextResponse.json({ message: "Validation failed", errors: messages }, { status: 400 });
    }

    return NextResponse.json({ message: "An error occurred while updating user status." }, { status: 500 });
  }
}
