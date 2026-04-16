// src/app/api/notifications/mark-read/route.ts
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import { getToken } from "next-auth/jwt";
import { getAuthSecret } from "@/lib/authSecret";

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authentication Check
    const token = await getToken({ req, secret: getAuthSecret() });
    if (!token) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }
    const userRole = token.role as string || 'user'; // Get user role
    if (!['admin', 'user'].includes(userRole)) { // Ensure role is valid
        return NextResponse.json({ message: "Invalid user role." }, { status: 403 });
    }

    // 2. Connect to Database
    await connectDB();

    // 3. Update Notifications based on role or 'all'
    // Find all unread notifications for the user's role OR for 'all' and set isRead to true
    const updateResult = await Notification.updateMany(
      {
        isRead: false,
        $or: [{ recipientRole: userRole }, { recipientRole: 'all' }]
      },
      { $set: { isRead: true } }
    );

    console.log(`User ${token.email} (Role: ${userRole}) marked ${updateResult.modifiedCount} notifications as read.`);

    // 4. Return Success Response
    return NextResponse.json(
      { message: "Notifications marked as read.", modifiedCount: updateResult.modifiedCount },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("API Error marking notifications as read:", error);
    return NextResponse.json({ message: "An error occurred while marking notifications as read." }, { status: 500 });
  }
}

// You could also use POST instead of PATCH if preferred.
