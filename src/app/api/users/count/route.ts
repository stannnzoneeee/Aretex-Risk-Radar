// src/app/api/users/count/route.ts
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User, { UserStatus } from "@/models/User"; // Import UserStatus
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose"; // Import mongoose
import { getAuthSecret } from "@/lib/authSecret";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authentication and Authorization Check (Admin Only)
    const token = await getToken({ req, secret: getAuthSecret() });

    if (!token) {
      return NextResponse.json({ message: "Authentication required." }, { status: 401 });
    }
    if (token.role !== "admin") {
      return NextResponse.json({ message: "Forbidden: Admin role required." }, { status: 403 });
    }

    // 2. Connect to Database
    await connectDB();

    // --- NEW: Read status query parameter ---
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") as UserStatus | null;

    // --- NEW: Build query object ---
    const query: mongoose.FilterQuery<typeof User> = {};
    if (status) {
        // Validate status if necessary
        if (['pending', 'approved', 'rejected'].includes(status)) {
             query.status = status;
        } else {
            console.warn(`Invalid status parameter received for count: ${status}`);
            // Return count of 0 or error for invalid status
            return NextResponse.json({ count: 0 }, { status: 200 });
            // Or: return NextResponse.json({ message: "Invalid status parameter." }, { status: 400 });
        }
    }
    // If no status is provided, the query remains empty {}, counting all users.

    // 3. Get the count of users matching the query
    const userCount = await User.countDocuments(query); // Use countDocuments() with the query

    // 4. Return the count
    return NextResponse.json({ count: userCount }, { status: 200 });

  } catch (error) {
    console.error("API Error fetching user count:", error);
    return NextResponse.json({ message: "An error occurred while fetching user count." }, { status: 500 });
  }
}
