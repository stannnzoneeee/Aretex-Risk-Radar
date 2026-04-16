import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import { getToken } from 'next-auth/jwt';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { getAuthSecret } from '@/lib/authSecret';

const SALT_ROUNDS = 10; // Use the same salt rounds as in registration/seeding

export async function PATCH(req: NextRequest) {
    await connectDB();

    // 1. Authentication Check
    const token = await getToken({ req, secret: getAuthSecret() });
    if (!token || !token.sub) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 2. Parse Request Body
        const body = await req.json();
        const { currentPassword, newPassword } = body;

        // 3. Input Validation
        if (!currentPassword || !newPassword) {
            return NextResponse.json({ error: 'Current password and new password are required.' }, { status: 400 });
        }

        // 4. Fetch User (Explicitly select password)
        const userId = token.sub;
        if (!mongoose.Types.ObjectId.isValid(userId)) {
             return NextResponse.json({ error: 'Invalid user ID format in token.' }, { status: 500 });
        }

        // --- Modification: Add .select('+password') ---
        const user = await User.findById(userId).select('+password');

        if (!user) {
            return NextResponse.json({ error: 'User not found.' }, { status: 404 });
        }

        // --- Modification: Add check for user.password ---
        if (!user.password) {
            console.error(`[API PATCH /users/own-profile/password-change] User ${user.email} found but has no password hash stored.`);
            return NextResponse.json({ error: 'Cannot verify password. Account issue.' }, { status: 500 });
        }

        // 5. Verify Current Password (Now user.password is guaranteed to be a string here)
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return NextResponse.json({ error: 'Incorrect current password.' }, { status: 400 });
        }

        // 6. Hash New Password
        const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // 7. Update User's Password in Database
        user.password = hashedNewPassword;
        await user.save();

        console.log(`[API PATCH /users/own-profile/password-change] Password updated successfully for user ${user.email}`);

        // 8. Return Success Response
        return NextResponse.json({ message: 'Password updated successfully!' }, { status: 200 });

    } catch (error: any) {
        console.error("[API PATCH /users/own-profile/password-change] Error updating password:", error);
        if (error instanceof SyntaxError) {
             return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
        }
        if (error instanceof mongoose.Error.ValidationError) {
            return NextResponse.json({ error: "Validation failed", errors: error.errors }, { status: 400 });
        }
        // Generic server error
        return NextResponse.json({ error: 'Server error while updating password.' }, { status: 500 });
    }
}
