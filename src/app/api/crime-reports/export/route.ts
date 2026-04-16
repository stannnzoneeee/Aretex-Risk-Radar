// src/app/api/crime-reports/export/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import connectDB from '@/lib/mongodb'; // Your DB connection function
import CrimeReport from '@/models/CrimeReports'; // Import CrimeReport model
import Location from '@/models/location'; // Import Location model
import CrimeType from '@/models/CrimeType'; // Import CrimeType model
import mongoose, { PipelineStage, Types } from 'mongoose'; // Import Types for ObjectId check
import * as ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import path from 'path';
import fs from 'fs';
import { getAuthSecret } from '@/lib/authSecret';

// Helper function to stream PDF to buffer (keep as is)
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

// Define the structure of the crime data after aggregation/projection
interface ExportCrimeData {
    crime_id: string;
    date: string; // Formatted date string
    time: string;
    day_of_week: string;
    case_status: string;
    event_proximity: string | 'N/A';
    indoors_or_outdoors: string | 'N/A';
    location_string: string; // Combined location string
    latitude: number | 'N/A';
    longitude: number | 'N/A';
    crime_type: string;
    crime_category: string;
    createdAt: string; // Formatted date string
}

// Helper to format location string from populated data
const formatLocationString = (location: any): string => {
    if (!location) return 'N/A';
    return [
        location.house_building_number,
        location.street_name,
        location.purok_block_lot,
        location.barangay,
        location.municipality_city,
        location.province,
        location.region,
        location.zip_code
    ].filter(Boolean).join(', ');
};


export async function GET(req: NextRequest) {
    // --- Authentication ---
    const secret = getAuthSecret();
    if (!secret) {
        console.error("Crime Export Error: Auth secret not set.");
        return NextResponse.json({ message: 'Authentication configuration error.' }, { status: 500 });
    }
    const token = await getToken({ req, secret });
    if (!token || token.role !== 'admin') {
        console.warn("Crime Export Warning: Unauthorized access attempt.");
        return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    try {
        await connectDB();

        // --- Parse Query Parameters ---
        const { searchParams } = new URL(req.url);
        const format = searchParams.get('format') as 'excel' | 'pdf' | null;
        // Filters from frontend
        const caseStatus = searchParams.get('case_status');
        const startDateStr = searchParams.get('start_date');
        const endDateStr = searchParams.get('end_date');
        const searchCrimeType = searchParams.get('search_crime_type');
        const searchLocation = searchParams.get('search_location');

        if (!format || (format !== 'excel' && format !== 'pdf')) {
            return NextResponse.json({ message: 'Invalid or missing format parameter (must be "excel" or "pdf")' }, { status: 400 });
        }

        // --- Build Mongoose Aggregation Pipeline ---
        const pipeline: PipelineStage[] = [];

        // Stage 1: Lookup Location
        pipeline.push({
            $lookup: {
                from: 'locations', // Collection name for Location model
                localField: 'location',
                foreignField: '_id',
                as: 'locationInfo'
            }
        });
        // Stage 2: Unwind Location (should always exist as it's required)
        pipeline.push({ $unwind: '$locationInfo' }); // No preserve needed if required:true

        // Stage 3: Lookup CrimeType
        pipeline.push({
            $lookup: {
                from: 'crime_types', // Collection name for CrimeType model
                localField: 'crime_type',
                foreignField: '_id',
                as: 'crimeTypeInfo'
            }
        });
        // Stage 4: Unwind CrimeType (should always exist as it's required)
        pipeline.push({ $unwind: '$crimeTypeInfo' }); // No preserve needed if required:true

        // Stage 5: Match based on filters
        const matchStage: Record<string, any> = {};
        if (caseStatus) {
            matchStage.case_status = caseStatus;
        }
        // Date Range Filter
        const dateFilter: Record<string, Date> = {};
        if (startDateStr) {
            try { dateFilter.$gte = new Date(startDateStr); } catch (e) { console.warn("Invalid start date format:", startDateStr); }
        }
        if (endDateStr) {
            try {
                const endDate = new Date(endDateStr);
                endDate.setHours(23, 59, 59, 999); // Include the whole end day
                dateFilter.$lte = endDate;
            } catch (e) { console.warn("Invalid end date format:", endDateStr); }
        }
        if (Object.keys(dateFilter).length > 0) {
            matchStage.date = dateFilter;
        }
        // Search Filters
        const searchConditions: any[] = [];
        if (searchCrimeType) {
            const crimeRegex = { $regex: searchCrimeType, $options: 'i' };
            searchConditions.push({
                $or: [
                    { 'crimeTypeInfo.crime_type': crimeRegex },
                    { 'crimeTypeInfo.crime_type_category': crimeRegex }
                ]
            });
        }
        if (searchLocation) {
            const locRegex = { $regex: searchLocation, $options: 'i' };
            searchConditions.push({
                $or: [
                    { 'locationInfo.house_building_number': locRegex },
                    { 'locationInfo.street_name': locRegex },
                    { 'locationInfo.purok_block_lot': locRegex },
                    { 'locationInfo.barangay': locRegex },
                    { 'locationInfo.municipality_city': locRegex },
                    { 'locationInfo.province': locRegex },
                    { 'locationInfo.region': locRegex },
                    { 'locationInfo.zip_code': locRegex },
                ]
            });
        }
        // Combine search conditions with other match criteria
        if (searchConditions.length > 0) {
            matchStage.$and = (matchStage.$and || []).concat(searchConditions);
        }
        // Add $match stage if there are any conditions
        if (Object.keys(matchStage).length > 0) {
            pipeline.push({ $match: matchStage });
        }

        // Stage 6: Project the desired fields for export
        pipeline.push({
            $project: {
                _id: 0, // Exclude default _id
                crime_id: 1,
                date: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                time: 1,
                day_of_week: 1,
                case_status: 1,
                event_proximity: { $ifNull: ['$event_proximity', 'N/A'] },
                indoors_or_outdoors: { $ifNull: ['$crime_occurred_indoors_or_outdoors', 'N/A'] },
                // Pass the whole locationInfo object to format later or format here
                location_string: { // Example: format directly in projection
                    $reduce: {
                        input: [
                            // Wrap each part with $toString
                            { $toString: { $ifNull: ['$locationInfo.house_building_number', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.street_name', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.purok_block_lot', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.barangay', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.municipality_city', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.province', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.region', ''] } },
                            { $toString: { $ifNull: ['$locationInfo.zip_code', ''] } } // Ensure zip_code is also converted
                        ],
                        initialValue: "",
                        in: {
                            // The $concat logic remains the same, but now inputs are guaranteed strings
                            $cond: [
                                { $eq: ["$$value", ""] },
                                { $cond: [{ $eq: ["$$this", ""] }, "", "$$this"] },
                                {
                                    $cond: [
                                        { $eq: ["$$this", ""] },
                                        "$$value",
                                        { $concat: ["$$value", ", ", "$$this"] }
                                    ]
                                }
                            ]
                        }
                    }
                },
                latitude: { $ifNull: ['$locationInfo.latitude', 'N/A'] },
                longitude: { $ifNull: ['$locationInfo.longitude', 'N/A'] },
                crime_type: '$crimeTypeInfo.crime_type',
                crime_category: '$crimeTypeInfo.crime_type_category',
                createdAt: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
            }
        });

        // Stage 7: Sort (e.g., by date descending)
        pipeline.push({ $sort: { date: -1, time: -1 } }); // Sort by date then time

        // --- Execute Aggregation ---
        const reports = await CrimeReport.aggregate<ExportCrimeData>(pipeline);

        // --- Handle No Results ---
        if (reports.length === 0) {
             console.log("No crime reports found matching criteria, generating empty export file.");
        }

        // --- Generate File based on Format ---

        // --- Excel Generation ---
        if (format === 'excel') {
            const headers = [
                "Crime ID", "Date", "Time", "Day", "Status", "Proximity", "Setting",
                "Location", "Latitude", "Longitude",
                "Crime Type", "Category", "Reported Date"
            ];
            const data = reports.map(r => [
                r.crime_id, r.date, r.time, r.day_of_week, r.case_status, r.event_proximity, r.indoors_or_outdoors,
                r.location_string || 'N/A', // Ensure N/A if string is empty
                r.latitude, r.longitude,
                r.crime_type, r.crime_category, r.createdAt
            ]);

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Crime Reports');
            worksheet.addRow(headers);
            data.forEach(row => worksheet.addRow(row));
            worksheet.columns = [
                { width: 15 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 15 }, { width: 10 }, // Basic info
                { width: 60 }, { width: 15 }, { width: 15 }, // Location
                { width: 25 }, { width: 20 }, { width: 12 }  // Crime Type & Date
            ];

            const buffer = await workbook.xlsx.writeBuffer();

            return new NextResponse(buffer, {
                status: 200,
                headers: {
                    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'Content-Disposition': 'attachment; filename="crime_reports.xlsx"',
                },
            });
        }

        // --- PDF Generation ---
        if (format === 'pdf') {
            let doc;
            const stream = new PassThrough();
            const boldFontName = 'Roboto-Bold';
            const regularFontName = 'Roboto-Regular';

            try {
                 // Font setup (paths, check, instantiate, register) - Keep this logic
                 const fontDir = path.join(process.cwd(), 'assets', 'fonts');
                 const regularFontPath = path.join(fontDir, 'Roboto-Regular.ttf');
                 const boldFontPath = path.join(fontDir, 'Roboto-Bold.ttf');
                 if (!fs.existsSync(regularFontPath)) throw new Error(`Regular font file not found at: ${regularFontPath}`);
                 if (!fs.existsSync(boldFontPath)) throw new Error(`Bold font file not found at: ${boldFontPath}`);
                 console.log("Font files found for PDF.");

                 doc = new PDFDocument({
                     margin: 20, // Smaller margin for more content
                     size: 'LEGAL', // Use a larger page size like LEGAL
                     layout: 'landscape',
                     bufferPages: true,
                     font: regularFontPath
                 });
                 doc.pipe(stream);
                 doc.registerFont(regularFontName, regularFontPath);
                 doc.registerFont(boldFontName, boldFontPath);
                 console.log("Successfully registered fonts for PDF.");

            } catch (setupError: any) {
                 console.error("!!! PDF Setup FAILED !!!", setupError);
                 stream.destroy(setupError);
                 return NextResponse.json({ message: `PDF generation failed during setup: ${setupError.message}. Check server logs.` }, { status: 500 });
            }

            // PDF Content Generation
            try {
                const startX = doc.page.margins.left;
                let currentY = doc.page.margins.top;
                const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

                // Adjust columns for crime reports - make location wider
                const headers = ["ID", "Date", "Time", "Day", "Status", "Crime Type", "Category", "Location", "Lat", "Lon"];
                const columnWidths = [70, 60, 50, 60, 60, 100, 100, 250, 50, 50]; // Adjusted widths, ensure sum fits LEGAL landscape (~936 usable)
                const rowHeight = 15;
                const headerFontSize = 7; // Smaller font for more columns
                const rowFontSize = 7;
                const pageBottomMargin = doc.page.margins.bottom;

                const drawHeaders = (yPos: number) => {
                    doc.font(boldFontName).fontSize(headerFontSize);
                    let currentX = startX;
                    headers.forEach((header, i) => {
                        doc.text(header, currentX + 2, yPos + 2, { width: columnWidths[i] - 4, align: 'left' }); // Add padding
                        // Draw vertical lines for columns
                        if (i < headers.length) {
                             doc.moveTo(currentX + columnWidths[i], yPos)
                                .lineTo(currentX + columnWidths[i], yPos + rowHeight)
                                .strokeColor('#cccccc') // Light gray lines
                                .stroke();
                        }
                        currentX += columnWidths[i];
                    });
                     // Draw horizontal line below header
                     doc.moveTo(startX, yPos + rowHeight)
                        .lineTo(startX + usableWidth, yPos + rowHeight)
                        .strokeColor('#aaaaaa') // Darker gray line
                        .stroke();
                    return yPos + rowHeight + 2; // Add padding below line
                };

                // Title
                doc.font(boldFontName).fontSize(12);
                doc.text("Crime Report List", startX, currentY, { align: 'center', width: usableWidth });
                currentY += 25;

                // Initial Headers
                currentY = drawHeaders(currentY);

                // Table Rows
                doc.font(regularFontName).fontSize(rowFontSize);

                if (reports.length === 0) {
                     doc.text("No crime reports found matching the specified criteria.", startX, currentY, { align: 'center', width: usableWidth });
                } else {
                    reports.forEach((r, rowIndex) => {
                        if (currentY + rowHeight > doc.page.height - pageBottomMargin) {
                            doc.addPage({ margin: 20, size: 'LEGAL', layout: 'landscape' });
                            currentY = doc.page.margins.top;
                            currentY = drawHeaders(currentY);
                            doc.font(regularFontName).fontSize(rowFontSize);
                        }
                        let currentX = startX;
                        const row = [
                            r.crime_id, r.date, r.time, r.day_of_week, r.case_status,
                            r.crime_type, r.crime_category,
                            r.location_string || 'N/A',
                            String(r.latitude), String(r.longitude) // Ensure string
                        ];

                        const rowStartY = currentY;

                        row.forEach((cell, i) => {
                            const cellText = String(cell ?? '');
                            doc.text(cellText, currentX + 2, rowStartY + 2, { // Add padding
                                width: columnWidths[i] - 4, // Adjust width for padding
                                align: 'left',
                                lineBreak: false,
                                ellipsis: true
                            });
                            // Draw vertical lines for columns
                            if (i < headers.length) {
                                doc.moveTo(currentX + columnWidths[i], rowStartY)
                                   .lineTo(currentX + columnWidths[i], rowStartY + rowHeight)
                                   .strokeColor('#cccccc')
                                   .stroke();
                            }
                            currentX += columnWidths[i];
                        });
                         // Draw horizontal line below row
                         doc.moveTo(startX, rowStartY + rowHeight)
                            .lineTo(startX + usableWidth, rowStartY + rowHeight)
                            .strokeColor('#cccccc')
                            .stroke();

                        currentY += rowHeight;
                    });
                }

                // Finalize
                doc.end();

            } catch (pdfError: any) {
                console.error('Error during PDF content generation:', pdfError);
                stream.destroy(pdfError);
                return NextResponse.json({ message: 'An error occurred during PDF content generation.' }, { status: 500 });
            }

            // Convert stream to buffer
            try {
                const pdfBuffer = await streamToBuffer(stream);
                return new NextResponse(pdfBuffer, {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/pdf',
                        'Content-Disposition': 'attachment; filename="crime_reports.pdf"',
                    },
                });
            } catch (streamError: any) {
                 console.error('Error converting PDF stream to buffer:', streamError);
                 return NextResponse.json({ message: 'An error occurred finalizing the PDF file.' }, { status: 500 });
            }
        }

        // Fallback
        return NextResponse.json({ message: 'Invalid format specified.' }, { status: 400 });

    } catch (error: any) {
        console.error('Unhandled error in crime report export route:', error);
        const message = error.message || 'An unexpected error occurred during the export process.';
        if (message.includes("PDF generation failed during setup")) {
             return NextResponse.json({ message }, { status: 500 });
        }
        return NextResponse.json({ message: 'An unexpected server error occurred.' }, { status: 500 });
    }
}
