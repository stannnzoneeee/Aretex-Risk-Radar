// src/app/api/users/bulk-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/mongodb';
import User, { UserStatus } from '@/models/User'; // Adjust path if needed
import mongoose from 'mongoose';
import { getToken } from 'next-auth/jwt'; // To check admin role
import { getAuthSecret } from '@/lib/authSecret';

const VALID_STATUSES: UserStatus[] = ['approved', 'rejected', 'pending']; // Define valid statuses

export async function PATCH(request: NextRequest) {
    await connectDB();

    // 1. Authorization Check
    const token = await getToken({ req: request, secret: getAuthSecret() });
    if (!token || token.role !== 'admin') {
        console.warn('[API /users/bulk-status] Unauthorized attempt.');
        return NextResponse.json({ message: 'Unauthorized' }, { status: 403 });
    }

    try {
        // 2. Parse Request Body
        const body = await request.json();
        const { userIds, status: targetStatus } = body; // Renamed status to targetStatus for clarity

        // 3. Validation
        if (!Array.isArray(userIds) || userIds.length === 0) {
            return NextResponse.json({ message: 'User IDs must be provided as a non-empty array.' }, { status: 400 });
        }
        if (!targetStatus || !VALID_STATUSES.includes(targetStatus as UserStatus)) {
            return NextResponse.json({ message: `Invalid target status provided. Must be one of: ${VALID_STATUSES.join(', ')}` }, { status: 400 });
        }

        const invalidIds = userIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
            console.warn(`[API /users/bulk-status] Invalid ObjectIds found: ${invalidIds.join(', ')}`);
            return NextResponse.json({ message: `Invalid user ID format found for: ${invalidIds.join(', ')}` }, { status: 400 });
        }

        const objectIds = userIds.map(id => new mongoose.Types.ObjectId(id));

        // --- Determine which current statuses are eligible for the update ---
        let eligibleCurrentStatuses: UserStatus[] = [];
        if (targetStatus === 'approved') {
            eligibleCurrentStatuses = ['pending', 'rejected'];
        } else if (targetStatus === 'rejected') {
            eligibleCurrentStatuses = ['pending', 'approved'];
        } else if (targetStatus === 'pending') { // Handle if you ever allow setting back to pending
             eligibleCurrentStatuses = ['approved', 'rejected'];
        }
        // --- End status eligibility ---


        // 4. Perform Bulk Update using updateMany with refined filter
        const updateResult = await User.updateMany(
            {
                _id: { $in: objectIds }, // Filter: User ID must be in the provided list
                status: { $in: eligibleCurrentStatuses } // Filter: Current status must be one of the eligible ones
            },
            { $set: { status: targetStatus } }  // Update: Set the status field to the target status
        );

        console.log(`[API /users/bulk-status] Bulk update result for target status '${targetStatus}':`, updateResult);

        // The message now more accurately reflects the action taken
        const message = `Attempted to set status to '${targetStatus}' for ${userIds.length} selected user(s). ${updateResult.modifiedCount} user(s) were updated (others may have already had the target status or were not found).`;

        // 5. Return Success Response
        return NextResponse.json({
            message: message,
            matchedCount: updateResult.matchedCount, // How many matched the ID *and* eligible status criteria
            modifiedCount: updateResult.modifiedCount // How many were actually updated
        }, { status: 200 });

    } catch (error: any) {
        console.error('[API /users/bulk-status] Error processing bulk status update:', error);

        if (error instanceof SyntaxError) {
             return NextResponse.json({ message: 'Invalid JSON in request body.' }, { status: 400 });
        }

        return NextResponse.json({ message: 'Internal Server Error', error: error.message || 'Unknown error' }, { status: 500 });
    }
}
