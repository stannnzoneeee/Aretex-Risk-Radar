// src/app/api/crime-reports/import/confirm/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import connectDB from '@/lib/mongodb';
import CrimeReport from '@/models/CrimeReports';
import Location from '@/models/location'; // Needed for type checking if we were re-fetching
import CrimeType from '@/models/CrimeType'; // Needed for type checking if we were re-fetching
import mongoose, { ClientSession } from 'mongoose';
import { getAuthSecret } from '@/lib/authSecret';

// --- Types (mirroring frontend payload) ---
// These should match the structure sent from the frontend,
// based on the analysis result.

interface ExcelRowData { // Simplified for this context
    CrimeID?: string;
    Date?: string | number | Date;
    Time?: string;
    DayOfWeek?: string;
    CaseStatus?: string;
    EventProximity?: string;
    IndoorsOrOutdoors?: string;
    // ... other Excel fields if needed for update logic
}

interface ProcessedReportInfo {
    row: number; // Keep for logging/error reporting
    crime_id: string;
    date: Date | string; // Date might be stringified in JSON
    time: string;
    day_of_week: string;
    case_status?: 'Ongoing' | 'Resolved' | 'Pending';
    event_proximity?: string;
    crime_occurred_indoors_or_outdoors?: 'Indoors' | 'Outdoors';
    locationId: string; // Resolved Location ObjectId as string
    crimeTypeId: string; // Resolved CrimeType ObjectId as string
    excelData: ExcelRowData; // Original Excel data might be useful
}

interface ConfirmationPayload {
    action: 'import_new_only' | 'import_and_update';
    validNewReports: ProcessedReportInfo[];
    potentialUpdates: ProcessedReportInfo[];
}

// --- Main Handler ---
export async function POST(req: NextRequest) {
    console.log("Received request for crime report import confirmation.");
    // 1. Authentication
    const secret = getAuthSecret();
    if (!secret) { /* ... auth error ... */ return NextResponse.json({ message: 'Auth config error' }, { status: 500 }); }
    const token = await getToken({ req, secret });
    if (!token || token.role !== 'admin') { /* ... auth error ... */ return NextResponse.json({ message: 'Unauthorized' }, { status: 401 }); }

    let session: ClientSession | null = null; // Initialize session variable

    try {
        await connectDB();

        // 2. Parse JSON Payload
        const payload: ConfirmationPayload = await req.json();
        const { action, validNewReports = [], potentialUpdates = [] } = payload;

        // Basic payload validation
        if (!action || (action !== 'import_new_only' && action !== 'import_and_update')) {
            return NextResponse.json({ message: 'Invalid or missing action specified.' }, { status: 400 });
        }
        if (!Array.isArray(validNewReports) || !Array.isArray(potentialUpdates)) {
             return NextResponse.json({ message: 'Invalid payload structure: report lists missing or not arrays.' }, { status: 400 });
        }

        console.log(`Confirmation Action: ${action}`);
        console.log(`New reports to process: ${validNewReports.length}`);
        console.log(`Updates to process: ${action === 'import_and_update' ? potentialUpdates.length : 0}`);

        // 3. Start Mongoose Transaction
        session = await mongoose.startSession();
        session.startTransaction();
        console.log("Transaction started.");

        let createdCount = 0;
        let updatedCount = 0;
        const errors: { row: number; crimeId: string; message: string }[] = [];

        // 4. Process New Reports
        for (const reportInfo of validNewReports) {
            try {
                // Double-check if crime_id somehow got created between analysis and confirmation
                const existing = await CrimeReport.findOne({ crime_id: reportInfo.crime_id }).session(session).lean();
                if (existing) {
                    console.warn(`Skipping creation for row ${reportInfo.row}: Crime ID ${reportInfo.crime_id} already exists (created concurrently?).`);
                    errors.push({ row: reportInfo.row, crimeId: reportInfo.crime_id, message: 'Crime ID already exists (created concurrently?). Skipping.' });
                    continue;
                }

                await CrimeReport.create([{ // Use array form for create
                    crime_id: reportInfo.crime_id,
                    date: new Date(reportInfo.date), // Ensure it's a Date object
                    time: reportInfo.time,
                    day_of_week: reportInfo.day_of_week,
                    case_status: reportInfo.case_status,
                    event_proximity: reportInfo.event_proximity,
                    crime_occurred_indoors_or_outdoors: reportInfo.crime_occurred_indoors_or_outdoors,
                    location: new mongoose.Types.ObjectId(reportInfo.locationId), // Convert string ID back to ObjectId
                    crime_type: new mongoose.Types.ObjectId(reportInfo.crimeTypeId), // Convert string ID back to ObjectId
                }], { session }); // Pass session to create
                createdCount++;
                console.log(`Row ${reportInfo.row}: Successfully created report ${reportInfo.crime_id}`);
            } catch (error: any) {
                console.error(`Error creating report for row ${reportInfo.row} (CrimeID: ${reportInfo.crime_id}):`, error);
                errors.push({ row: reportInfo.row, crimeId: reportInfo.crime_id, message: `Failed to create: ${error.message}` });
                // Decide if one error should stop the whole batch
                await session.abortTransaction();
                console.log("Transaction aborted due to creation error.");
                return NextResponse.json({
                    message: `Error processing row ${reportInfo.row}. Import aborted.`,
                    errors
                }, { status: 500 });
            }
        }

        // 5. Process Updates (if action allows)
        if (action === 'import_and_update') {
            for (const reportInfo of potentialUpdates) {
                try {
                    const updateData = {
                        date: new Date(reportInfo.date), // Ensure Date object
                        time: reportInfo.time,
                        day_of_week: reportInfo.day_of_week,
                        case_status: reportInfo.case_status,
                        event_proximity: reportInfo.event_proximity,
                        crime_occurred_indoors_or_outdoors: reportInfo.crime_occurred_indoors_or_outdoors,
                        location: new mongoose.Types.ObjectId(reportInfo.locationId),
                        crime_type: new mongoose.Types.ObjectId(reportInfo.crimeTypeId),
                        // Add other fields from reportInfo or reportInfo.excelData if needed
                    };

                    const result = await CrimeReport.findOneAndUpdate(
                        { crime_id: reportInfo.crime_id }, // Find by the unique crime_id
                        { $set: updateData }, // Use $set to update fields
                        { session, new: false } // Pass session, new:false returns original if needed, true returns updated
                    );

                    if (!result) {
                        // This case is unlikely if analysis was correct, but handle it
                        console.warn(`Update skipped for row ${reportInfo.row}: Crime ID ${reportInfo.crime_id} not found during update.`);
                        errors.push({ row: reportInfo.row, crimeId: reportInfo.crime_id, message: 'Crime ID not found during update. Skipping.' });
                    } else {
                        updatedCount++;
                        console.log(`Row ${reportInfo.row}: Successfully updated report ${reportInfo.crime_id}`);
                    }
                } catch (error: any) {
                    console.error(`Error updating report for row ${reportInfo.row} (CrimeID: ${reportInfo.crime_id}):`, error);
                    errors.push({ row: reportInfo.row, crimeId: reportInfo.crime_id, message: `Failed to update: ${error.message}` });
                    // Decide if one error should stop the whole batch
                    await session.abortTransaction();
                    console.log("Transaction aborted due to update error.");
                    return NextResponse.json({
                        message: `Error processing row ${reportInfo.row} for update. Import aborted.`,
                        errors
                    }, { status: 500 });
                }
            }
        }

        // 6. Commit Transaction
        await session.commitTransaction();
        console.log("Transaction committed successfully.");

        // 7. Return Success Response
        return NextResponse.json({
            message: `Import successful!`,
            created: createdCount,
            updated: updatedCount,
            skippedErrors: errors // Include non-fatal errors/warnings if any occurred
        }, { status: 200 });

    } catch (error: any) {
        // Abort transaction if it's still active and an error occurred outside the loops
        if (session && session.inTransaction()) {
            try {
                await session.abortTransaction();
                console.log("Transaction aborted due to top-level error.");
            } catch (abortError) {
                console.error("Failed to abort transaction:", abortError);
            }
        }
        console.error('Import Confirmation Error: Top-level handler caught error.', error);
        return NextResponse.json({ message: `An unexpected error occurred during import confirmation: ${error.message}` }, { status: 500 });
    } finally {
        // End the session regardless of success or failure
        if (session) {
            await session.endSession();
            console.log("Session ended.");
        }
    }
}
