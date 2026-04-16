// src/app/api/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import Notification from "@/models/Notification";
import { getToken } from "next-auth/jwt";
import { getAuthSecret } from "@/lib/authSecret";

const MAX_NOTIFICATIONS = 50; // Limit the number of notifications fetched

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authentication Check
    const token = await getToken({ req, secret: getAuthSecret() });
    if (!token) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }
    const userRole = token.role as string || 'user'; // Get user role, default to 'user'
    if (!['admin', 'user'].includes(userRole)) { // Ensure role is valid
        return NextResponse.json({ message: "Invalid user role." }, { status: 403 });
    }

    // 2. Connect to Database
    await connectDB();

    // 3. Determine if fetching only unread or all (based on query param)
    const url = new URL(req.url);
    const fetchUnreadOnly = url.searchParams.get("read") === "false";

    // 4. Query for Notifications based on role or 'all'
    const queryFilter: any = {
        $or: [
            { recipientRole: userRole }, // Notifications for their specific role
            { recipientRole: 'all' }     // Notifications for everyone
        ]
    };
    if (fetchUnreadOnly) {
      queryFilter.isRead = false;
    }

    const notifications = await Notification.find(queryFilter)
      .sort({ createdAt: -1 }) // Show newest first
      .limit(MAX_NOTIFICATIONS) // Limit results
      .lean(); // Use lean for performance if not modifying docs

    // 5. Count Unread Notifications Separately
    const unreadCount = await Notification.countDocuments({
      isRead: false,
      $or: [
        { recipientRole: userRole }, // Count unread for their specific role
        { recipientRole: 'all' }     // Count unread for everyone
      ]
    });

    // 6. Return Success Response
    return NextResponse.json(
      { notifications, unreadCount },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("API Error fetching notifications:", error);
    return NextResponse.json({ message: "An error occurred while fetching notifications." }, { status: 500 });
  }
}
