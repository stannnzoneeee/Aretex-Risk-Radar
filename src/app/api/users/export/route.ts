// src/app/api/users/export/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import connectDB from '@/lib/mongodb'; // Assuming this is your DB connection function
import User, { IUser, UserStatus } from '@/models/User';
import UserProfile, { IUserProfile, UserSex } from '@/models/UserProfile';
import mongoose, { PipelineStage } from 'mongoose';
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream'; // Use standard import for stream
import path from 'path'; // Import path module for joining paths
import fs from 'fs'; // Import fs to check if font files exist

// Helper function to stream PDF to buffer
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

// Define the structure of the user data after aggregation/projection
interface ExportUserData {
    name: string;
    email: string;
    sex: UserSex | 'N/A';
    employeeNumber: string | 'N/A';
    workPosition: string | 'N/A';
    team: string | 'N/A';
    role: 'admin' | 'user';
    status: UserStatus;
    createdAt: string; // Formatted date string
}

export async function GET(req: NextRequest) {
    // --- Authentication and Parameter Parsing ---
    const secret = process.env.SESSION_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) {
        console.error("Authentication secret (SESSION_SECRET or NEXTAUTH_SECRET) is not set in environment variables.");
        return NextResponse.json({ message: 'Authentication configuration error.' }, { status: 500 });
    }

    const token = await getToken({ req, secret });

    // 1. Authentication: Ensure user is admin
    if (!token || token.role !== 'admin') {
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    try {
        await connectDB();

        // 2. Parse Query Parameters
        const { searchParams } = new URL(req.url);
        const format = searchParams.get('format') as 'excel' | 'pdf' | null;
        const status = searchParams.get('status') as UserStatus | null;
        const sex = searchParams.get('sex') as UserSex | null;
        const search = searchParams.get('search');

        if (!format || (format !== 'excel' && format !== 'pdf')) {
            return NextResponse.json({ message: 'Invalid or missing format parameter (must be "excel" or "pdf")' }, { status: 400 });
        }

        // 3. Build Mongoose Aggregation Pipeline
        const pipeline: PipelineStage[] = [];
        // Stages 1-5 (Lookup, Unwind, Match, Project, Sort)
        pipeline.push({ $lookup: { from: 'user_profiles', localField: 'profile', foreignField: '_id', as: 'profileInfo' } });
        pipeline.push({ $unwind: { path: '$profileInfo', preserveNullAndEmptyArrays: true } });
        // Add $match stage conditionally
        const matchStage: Record<string, any> = {};
        if (status) matchStage.status = status;
        if (sex) matchStage['profileInfo.sex'] = sex;
        if (search) {
            const searchRegex = { $regex: search, $options: 'i' };
            matchStage.$or = [ { email: searchRegex }, { 'profileInfo.firstName': searchRegex }, { 'profileInfo.lastName': searchRegex }, { 'profileInfo.employeeNumber': searchRegex }, { 'profileInfo.workPosition': searchRegex }, { 'profileInfo.team': searchRegex }, ];
        }
        if (Object.keys(matchStage).length > 0) pipeline.push({ $match: matchStage });
        // Projection
        pipeline.push({
            $project: {
                _id: 0, name: { $trim: { input: { $concat: [ { $ifNull: ['$profileInfo.firstName', ''] }, ' ', { $ifNull: ['$profileInfo.lastName', ''] } ] } } },
                email: 1, sex: { $ifNull: ['$profileInfo.sex', 'N/A'] }, employeeNumber: { $ifNull: ['$profileInfo.employeeNumber', 'N/A'] },
                workPosition: { $ifNull: ['$profileInfo.workPosition', 'N/A'] }, team: { $ifNull: ['$profileInfo.team', 'N/A'] },
                role: 1, status: 1, createdAt: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
            }
        });
        pipeline.push({ $sort: { name: 1 } });


        // 4. Execute Aggregation
        const users = await User.aggregate<ExportUserData>(pipeline);

        // 5. Handle No Users Found
        if (users.length === 0) {
             console.log("No users found matching criteria, generating empty export file.");
        }

        // 6. Generate File based on Format

        // --- Excel Generation ---
        if (format === 'excel') {
            const headers = [ "Name", "Email", "Sex", "Employee No.", "Work Position", "Team", "Role", "Status", "Registered Date" ];
            const data = users.map(user => [ user.name || 'N/A', user.email, user.sex, user.employeeNumber, user.workPosition, user.team, user.role, user.status, user.createdAt ]);
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Users');
            worksheet.addRow(headers);
            data.forEach(row => worksheet.addRow(row));
            worksheet.columns = [ { width: 25 }, { width: 30 }, { width: 15 }, { width: 15 }, { width: 20 }, { width: 20 }, { width: 10 }, { width: 12 }, { width: 15 } ];
            const buffer = await workbook.xlsx.writeBuffer();
            return new NextResponse(buffer, { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="users.xlsx"', }, });
        }

        // --- PDF Generation (Using Explicit Fonts - Requires files in assets/fonts) ---
        if (format === 'pdf') {
            let doc;
            const stream = new PassThrough(); // Create stream early

            // Define font aliases
            const boldFontName = 'Roboto-Bold';
            const regularFontName = 'Roboto-Regular'; // Alias for registration

            try {
                 // --- DEFINE FONT PATHS AND NAMES ---
                 const fontDir = path.join(process.cwd(), 'assets', 'fonts');
                 const regularFontPath = path.join(fontDir, 'Roboto-Regular.ttf');
                 const boldFontPath = path.join(fontDir, 'Roboto-Bold.ttf');
                 const regularFontName = 'Roboto-Regular'; // Alias for registration
                 const boldFontName = 'Roboto-Bold';       // Alias for registration

                 // --- CHECK FONT FILES EXIST --- (Crucial before instantiation)
                 if (!fs.existsSync(regularFontPath)) {
                    throw new Error(`Regular font file not found at: ${regularFontPath}`);
                 }
                 if (!fs.existsSync(boldFontPath)) {
                    throw new Error(`Bold font file not found at: ${boldFontPath}`);
                 }
                 console.log("Font files found. Proceeding with PDF instantiation.");

                 // --- INSTANTIATE PDFDocument ---
                 // Explicitly set the 'font' option to the PATH of the regular font
                 doc = new PDFDocument({
                     margin: 30,
                     size: 'A4',
                     layout: 'landscape',
                     bufferPages: true, // Keep this, might still be helpful
                     font: regularFontPath // <--- Point to the actual font file path
                 });

                 // Pipe the stream immediately after successful instantiation
                 doc.pipe(stream);

                 // --- REGISTER FONTS (Still needed for aliases and bold variant) ---
                 // Use the aliases (regularFontName, boldFontName) for registration
                 doc.registerFont(regularFontName, regularFontPath);
                 doc.registerFont(boldFontName, boldFontPath);
                 console.log("Successfully registered font aliases for PDF generation.");

            } catch (setupError: any) {
                 // Catch errors during file check, instantiation, or registration
                 console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
                 console.error("!!! PDF Setup FAILED (Font Check, Instantiation, or Registration) !!!");
                 console.error(`!!! Error: ${setupError.message}`);
                 console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
                 // Destroy the stream if setup fails before piping potentially starts writing
                 stream.destroy(setupError);
                 return NextResponse.json({ message: `PDF generation failed during setup: ${setupError.message}. Check server logs.` }, { status: 500 });
            }

            // --- PDF Content Generation ---
            // This block only runs if setup was successful
            try {
                // Define layout constants
                const startX = doc.page.margins.left;
                let currentY = doc.page.margins.top;
                const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
                const columnWidths = [100, 120, 50, 70, 80, 80, 40, 50, 60];
                const headers = ["Name", "Email", "Sex", "Employee No.", "Position", "Team", "Role", "Status", "Registered"];
                const rowHeight = 15;
                const headerFontSize = 8;
                const rowFontSize = 8;
                const pageBottomMargin = doc.page.margins.bottom;

                // Function to draw headers - Use registered font *aliases*
                const drawHeaders = (yPos: number) => {
                    doc.font(boldFontName).fontSize(headerFontSize); // Use alias 'Roboto-Bold'
                    let currentX = startX;
                    headers.forEach((header, i) => {
                        doc.text(header, currentX, yPos, { width: columnWidths[i], align: 'left' });
                        currentX += columnWidths[i];
                    });
                    return yPos + rowHeight * 1.5;
                };

                // Title - Use registered font *alias*
                doc.font(boldFontName).fontSize(12); // Use alias 'Roboto-Bold'
                doc.text("User List", startX, currentY, { align: 'center', width: usableWidth });
                currentY += 25;

                // Initial Headers
                currentY = drawHeaders(currentY);

                // Table Rows - Use registered font *alias*
                doc.font(regularFontName).fontSize(rowFontSize); // Use alias 'Roboto-Regular'

                if (users.length === 0) {
                     doc.text("No users found matching the specified criteria.", startX, currentY, { align: 'center', width: usableWidth });
                } else {
                    users.forEach((user) => {
                        if (currentY + rowHeight > doc.page.height - pageBottomMargin) {
                            doc.addPage({ margin: 30, size: 'A4', layout: 'landscape' });
                            currentY = doc.page.margins.top;
                            currentY = drawHeaders(currentY);
                            doc.font(regularFontName).fontSize(rowFontSize); // Reset font alias
                        }
                        let currentX = startX;
                        const row = [ user.name || 'N/A', user.email, user.sex, user.employeeNumber, user.workPosition, user.team, user.role, user.status, user.createdAt ];
                        row.forEach((cell, i) => {
                            const cellText = String(cell ?? '');
                            doc.text(cellText, currentX, currentY, { width: columnWidths[i], align: 'left', lineBreak: false, ellipsis: true });
                            currentX += columnWidths[i];
                        });
                        currentY += rowHeight;
                    });
                }

                // Finalize the PDF document
                doc.end();

            } catch (pdfError: any) {
                console.error('Error during PDF content generation:', pdfError);
                stream.destroy(pdfError); // Ensure stream is destroyed on error
                return NextResponse.json({ message: 'An error occurred during PDF content generation.' }, { status: 500 });
            }

            // Convert stream to buffer
            try {
                const pdfBuffer = await streamToBuffer(stream);
                return new NextResponse(pdfBuffer, {
                    status: 200,
                    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="users.pdf"', },
                });
            } catch (streamError: any) {
                 console.error('Error converting PDF stream to buffer:', streamError);
                 return NextResponse.json({ message: 'An error occurred finalizing the PDF file.' }, { status: 500 });
            }
        }

        // Fallback
        return NextResponse.json({ message: 'Invalid format specified.' }, { status: 400 });

    } catch (error: any) {
        // Catch any other unhandled errors (DB, aggregation, etc.)
        console.error('Unhandled error in user export route:', error);
        const message = error.message || 'An unexpected error occurred during the export process.';
        // Check for specific setup error message to avoid duplication
        if (message.includes("PDF generation failed during setup")) {
             return NextResponse.json({ message }, { status: 500 });
        }
        return NextResponse.json({ message: 'An unexpected server error occurred.' }, { status: 500 });
    }
}
