import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import User from "@/models/User";


import { getToken } from "next-auth/jwt";
import { getAuthSecret } from "@/lib/authSecret";

export async function GET(req: NextRequest) {
  await connectDB();

  // Get the logged-in user's token from the request
  const token = await getToken({ req, secret: getAuthSecret() });

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Find the user by ID from the token
    const user = await User.findById(token.sub).populate("profile");

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ data: user }, { status: 200 });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
