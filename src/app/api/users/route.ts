// src/app/api/users/route.ts
import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User, { UserStatus } from "@/models/User"; // Import UserStatus
import UserProfile from "@/models/UserProfile";
import { getToken } from "next-auth/jwt";
import mongoose from "mongoose";
import { getAuthSecret } from "@/lib/authSecret";

// Helper function to parse sort parameter
const parseSortParam = (sortParam: string | null): { [key: string]: 1 | -1 } => {
  if (!sortParam) {
    return { createdAt: -1 }; // Default sort
  }
  const [field, direction] = sortParam.split(':');
  const sortOrder = direction?.toLowerCase() === 'asc' ? 1 : -1;
  return { [field]: sortOrder };
};


// GET users with filtering, sorting, and pagination (Admin only)
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // 1. Authentication and Authorization Check
    const token = await getToken({ req, secret: getAuthSecret() });
    if (!token || token.role !== "admin") {
      return NextResponse.json(
        { message: token ? "Forbidden: Admin role required." : "Authentication required." },
        { status: token ? 403 : 401 }
      );
    }

    // 2. Connect to Database
    await connectDB();

    // --- NEW: Read Query Parameters ---
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") as UserStatus | null; // Get status filter
    const limitParam = searchParams.get("limit");
    const sortParam = searchParams.get("sort"); // Get sort parameter (e.g., 'createdAt:desc')

    const limit = limitParam ? parseInt(limitParam, 10) : undefined; // Parse limit, default to no limit if not provided
    const sortOptions = parseSortParam(sortParam); // Parse sort options

    // --- NEW: Build Query Object ---
    const query: mongoose.FilterQuery<typeof User> = {}; // Use FilterQuery type
    if (status) {
        // Validate status if necessary (e.g., ensure it's 'pending', 'approved', 'rejected')
        if (['pending', 'approved', 'rejected'].includes(status)) {
             query.status = status;
        } else {
            console.warn(`Invalid status parameter received: ${status}`);
            // Optionally return an error or ignore invalid status
            // return NextResponse.json({ message: "Invalid status parameter." }, { status: 400 });
        }
    }
    // Add other potential filters here (e.g., search term) if needed in the future

    console.log("Executing User query:", JSON.stringify(query, null, 2));
    console.log("Sort options:", sortOptions);
    console.log("Limit:", limit);
    // --- End Query Parameter Handling ---


    // 3. Fetch users based on query, sort, and limit
    let userQuery = User.find(query) // Apply the filter query
      .populate<{ profile: typeof UserProfile }>({
        path: "profile",
        model: UserProfile,
        select: 'firstName lastName employeeNumber workPosition team sex birthdate profilePictureUrl', // <-- Added profilePictureUrl
      })
      .select("-password")
      .sort(sortOptions); // Apply sorting

    // Apply limit only if it's a valid number > 0
    if (limit && !isNaN(limit) && limit > 0) {
        userQuery = userQuery.limit(limit); // Apply limit
    }

    const users = await userQuery.lean(); // Execute the query

    // 4. Return the fetched users
    // Note: For the dashboard, we only needed the array.
    // If you reuse this for the main User Management page, you might need total count as well.
    return NextResponse.json(users, { status: 200 });

  } catch (error) {
    console.error("API Error fetching users:", error);
    return NextResponse.json({ message: "An error occurred while fetching users." }, { status: 500 });
  }
}
