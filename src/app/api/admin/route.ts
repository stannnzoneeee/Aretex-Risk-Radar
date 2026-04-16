import { authOptions } from "@/auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

// only admins can access this API

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin") {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ message: "Hello Admin!" }, { status: 200 });
}
