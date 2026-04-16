// src/app/api/crime-reports/import/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import connectDB from '@/lib/mongodb';
import CrimeReport from '@/models/CrimeReports';
import Location, { ILocation } from '@/models/location'; // Import Location model and interface
import CrimeType from '@/models/CrimeType'; // Import CrimeType model
import mongoose, { ClientSession } from 'mongoose';
import * as ExcelJS from 'exceljs';
import { getAuthSecret } from '@/lib/authSecret';

// --- Configuration ---
// Define expected Excel column headers (MUST match your template EXACTLY)
const EXPECTED_HEADERS = [
    'CrimeID',
    'Date',
    'Time',
    'DayOfWeek',
    'CaseStatus',
    'EventProximity', // Optional
    'IndoorsOrOutdoors', // Optional
    // Location Fields
    'HouseBuildingNumber', // Optional
    'StreetName',          // Optional
    'PurokBlockLot',       // Optional
    'Barangay',            // Required
    'MunicipalityCity',    // Required
    'Province',            // Required
    'ZipCode',             // Optional
    'Region',              // Required
    // Crime Type Fields
    'CrimeType',           // Required (Name of the crime type)
    'CrimeCategory'        // Required (Category for the crime type) // <<< ADDED
];
// Define required fields from the Excel row for basic validity
const REQUIRED_FIELDS = [
    'CrimeID', 'Date', 'Time', 'DayOfWeek',
    'Barangay', 'MunicipalityCity', 'Province', 'Region', // Required Location parts
    'CrimeType', // Required Crime Type Name
    'CrimeCategory' // Required Crime Category // <<< ADDED
];

// --- Helper Types ---
interface ExcelRowData {
    [key: string]: string | number | Date | null | undefined;
    __rowNum__: number;
    CrimeID?: string;
    Date?: string | number | Date;
    Time?: string;
    DayOfWeek?: string;
    CaseStatus?: string;
    EventProximity?: string;
    IndoorsOrOutdoors?: string;
    HouseBuildingNumber?: string;
    StreetName?: string;
    PurokBlockLot?: string;
    Barangay?: string;
    MunicipalityCity?: string;
    Province?: string;
    ZipCode?: string;
    Region?: string;
    CrimeType?: string;
    CrimeCategory?: string; // <<< ADDED
}

interface ValidationError {
    row: number;
    field: string;
    message: string;
    value?: any;
}

// Information about a potential duplicate found in the DB
interface DuplicateInfo {
    row: number;
    existingReportId: string; // The _id of the existing CrimeReport
    duplicateCrimeId: string; // The crime_id causing the conflict
    excelData: ExcelRowData; // The data from the Excel row causing the duplicate flag
}

// Structure for a validated report ready for potential creation/update
interface ProcessedReportInfo {
    row: number;
    crime_id: string;
    date: Date;
    time: string;
    day_of_week: string;
    case_status?: 'Ongoing' | 'Resolved' | 'Pending';
    event_proximity?: string;
    crime_occurred_indoors_or_outdoors?: 'Indoors' | 'Outdoors';
    locationId: string; // Resolved or newly created Location ObjectId
    crimeTypeId: string; // Resolved or newly created CrimeType ObjectId
    excelData: ExcelRowData; // Keep original Excel data for confirmation step
}

interface ImportAnalysisResult {
    fileName: string;
    totalRows: number;
    validNewReports: ProcessedReportInfo[];
    potentialUpdates: ProcessedReportInfo[];
    validationErrors: ValidationError[];
    duplicateValidationErrors: ValidationError[];
}

type ExcelCellPrimitive = string | number | Date | null;

function normalizeExcelCellValue(value: ExcelJS.CellValue, fallbackText = ''): ExcelCellPrimitive {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'boolean') return String(value);

    if ('result' in value && value.result !== undefined) {
        return normalizeExcelCellValue(value.result, fallbackText);
    }
    if ('richText' in value) {
        return value.richText.map(part => part.text).join('');
    }
    if ('text' in value) {
        return value.text;
    }
    if ('error' in value) {
        return value.error;
    }

    return fallbackText || null;
}

function normalizeHeader(value: ExcelCellPrimitive): string {
    if (value == null) return '';
    return String(value).trim();
}

function readWorksheetData(worksheet: ExcelJS.Worksheet): { headerRow: string[]; jsonData: ExcelRowData[] } {
    const firstRow = worksheet.getRow(1);
    const headerRow = Array.from({ length: worksheet.columnCount }, (_, index) => {
        const cell = firstRow.getCell(index + 1);
        return normalizeHeader(normalizeExcelCellValue(cell.value, cell.text));
    });

    const jsonData: ExcelRowData[] = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowData: ExcelRowData = { __rowNum__: rowNumber };
        let hasValues = false;

        headerRow.forEach((header, index) => {
            if (!header) return;

            const cell = row.getCell(index + 1);
            const value = normalizeExcelCellValue(cell.value, cell.text);
            if (value != null && String(value).trim() !== '') {
                hasValues = true;
            }
            rowData[header] = value;
        });

        if (hasValues) {
            jsonData.push(rowData);
        }
    });

    return { headerRow, jsonData };
}

function parseExcelSerialDate(serial: number): Date | null {
    if (!Number.isFinite(serial) || serial < 1 || serial > 60000) return null;

    const excelEpoch = Date.UTC(1899, 11, 30);
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    return new Date(excelEpoch + serial * millisecondsPerDay);
}

function parseImportedDate(value: ExcelRowData['Date']): Date | null {
    if (value instanceof Date && !isNaN(value.getTime())) {
        return value;
    }

    if (typeof value === 'number') {
        return parseExcelSerialDate(value);
    }

    if (value == null) {
        return null;
    }

    const textValue = String(value).trim();
    const numericValue = Number(textValue);
    if (textValue !== '' && Number.isFinite(numericValue) && /^\d+(\.\d+)?$/.test(textValue)) {
        const serialDate = parseExcelSerialDate(numericValue);
        if (serialDate) return serialDate;
    }

    const parsedDate = new Date(textValue);
    return isNaN(parsedDate.getTime()) ? null : parsedDate;
}

// --- Helper Functions ---

// Find or Create Location
async function findOrCreateLocation(locData: Partial<ILocation>, session?: ClientSession): Promise<string | null> {
    const query = {
        barangay: locData.barangay,
        municipality_city: locData.municipality_city,
        province: locData.province,
        region: locData.region,
        // street_name: locData.street_name || null, // Consider adding if needed for uniqueness
    };

    try {
        let location = await Location.findOne(query).session(session || null).lean();

        if (location) {
            return location._id.toString();
        } else {
            const newLocation = new Location({
                house_building_number: locData.house_building_number,
                street_name: locData.street_name,
                purok_block_lot: locData.purok_block_lot,
                barangay: locData.barangay,
                municipality_city: locData.municipality_city,
                province: locData.province,
                zip_code: locData.zip_code,
                region: locData.region,
            });
            // Geocoding happens in pre-save hook
            const savedLocation = await newLocation.save({ session: session || undefined }) as mongoose.Document & { _id: mongoose.Types.ObjectId };
            console.log(`Created new location with ID: ${savedLocation._id}`);
            return savedLocation._id.toString();
        }
    } catch (error: any) {
        console.error(`Error finding or creating location for Barangay "${locData.barangay}": ${error.message}`);
        return null;
    }
}

// Find or Create Crime Type // <<< MODIFIED FUNCTION
async function findOrCreateCrimeType(
    crimeTypeName: string,
    crimeCategory: string, // Added category parameter
    session?: ClientSession
): Promise<string | null> {
    if (!crimeTypeName || !crimeCategory) {
        console.error("findOrCreateCrimeType Error: Crime Type Name and Category are required.");
        return null; // Cannot proceed without both
    }

    try {
        // Case-insensitive search for crime type name
        let crimeType = await CrimeType.findOne({
            crime_type: { $regex: `^${crimeTypeName}$`, $options: 'i' }
        }).session(session || null).lean() as { _id: mongoose.Types.ObjectId } | null; // Added type assertion

        if (crimeType) {
            // Found existing crime type
            return crimeType._id.toString();
        } else {
            // Crime type not found, create a new one
            console.log(`Crime Type "${crimeTypeName}" not found. Attempting to create...`);
            const newCrimeType = new CrimeType({
                crime_type: crimeTypeName, // Use the exact name from Excel (consider trimming/cleaning if needed)
                crime_type_category: crimeCategory // Use the category from Excel
            });
            // Save within the session if provided
            const savedCrimeType = await newCrimeType.save({ session: session || undefined }) as mongoose.Document & { _id: mongoose.Types.ObjectId, crime_type: string }; // Added type assertion
            console.log(`Created new Crime Type "${savedCrimeType.crime_type}" with ID: ${savedCrimeType._id}`);
            return savedCrimeType._id.toString();
        }
    } catch (error: any) {
        // Handle potential unique constraint errors if two imports try to create the same type concurrently
        if (error.code === 11000) { // MongoDB duplicate key error code
             console.warn(`findOrCreateCrimeType: Concurrent creation attempt for "${crimeTypeName}". Retrying find...`);
             // Attempt to find it again, assuming another process just created it
             const existing = await CrimeType.findOne({
                 crime_type: { $regex: `^${crimeTypeName}$`, $options: 'i' }
             }).session(session || null).lean() as { _id: mongoose.Types.ObjectId } | null; // Added type assertion
             if (existing) return existing._id.toString();
             // If still not found after retry, something else is wrong
             console.error(`findOrCreateCrimeType: Error finding "${crimeTypeName}" after duplicate key error retry.`);
             return null;
        }
        console.error(`Error finding or creating Crime Type "${crimeTypeName}": ${error.message}`);
        return null; // Indicate failure
    }
}


// --- Main Handler ---
export async function POST(req: NextRequest) {
    console.log("Received request for crime report import analysis.");
    // 1. Authentication
    const secret = getAuthSecret();
    if (!secret) { return NextResponse.json({ message: 'Auth config error' }, { status: 500 }); }
    const token = await getToken({ req, secret });
    if (!token || token.role !== 'admin') { return NextResponse.json({ message: 'Unauthorized' }, { status: 401 }); }

    // 2. File Handling
    let file: File | null = null;
    let fileName = 'unknown file';
    try {
        const formData = await req.formData();
        const fileEntry = formData.get('file');
        if (!fileEntry || !(fileEntry instanceof File)) { return NextResponse.json({ message: 'No file uploaded.' }, { status: 400 }); }
        file = fileEntry;
        fileName = file.name;
        if (!fileName.endsWith('.xlsx')) { return NextResponse.json({ message: 'Invalid file type. Only .xlsx.' }, { status: 400 }); }
        const fileBuffer = await file.arrayBuffer();

        // 3. Excel Parsing
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(fileBuffer);
        const worksheet = workbook.worksheets[0];
        if (!worksheet) { return NextResponse.json({ message: 'Excel file empty/invalid.' }, { status: 400 }); }
        const { headerRow, jsonData } = readWorksheetData(worksheet);

        if (jsonData.length === 0) { return NextResponse.json({ fileName, totalRows: 0, validNewReports: [], potentialUpdates: [], validationErrors: [], duplicateValidationErrors: [] } as ImportAnalysisResult, { status: 200 }); }
        console.log(`Parsed ${jsonData.length} rows from ${fileName}.`);

        // --- Header Validation ---
        const actualHeaders = headerRow.map(h => h?.trim()).filter(Boolean);
        const missingHeaders = REQUIRED_FIELDS.filter(h => !actualHeaders.includes(h));
        if (missingHeaders.length > 0) {
            console.error(`Import Error: Missing required headers: ${missingHeaders.join(', ')}`);
            return NextResponse.json({ message: `Missing required columns: ${missingHeaders.join(', ')}. Expected includes: ${REQUIRED_FIELDS.join(', ')}` }, { status: 400 });
        }
        // --- End Header Validation ---

        // 4. Data Processing and Analysis
        await connectDB();
        const results: ImportAnalysisResult = {
            fileName,
            totalRows: jsonData.length,
            validNewReports: [],
            potentialUpdates: [],
            validationErrors: [],
            duplicateValidationErrors: [],
        };

        const existingReports = await CrimeReport.find({}, { crime_id: 1 }).lean();
        const existingCrimeIds = new Set(existingReports.map(r => r.crime_id));

        // Optional: Use session for atomic findOrCreate operations
        // const session = await mongoose.startSession();
        // session.startTransaction();

        try {
            for (const row of jsonData) {
                const rowNum = row.__rowNum__ || jsonData.indexOf(row) + 2;
                let isValid = true;
                const rowErrors: ValidationError[] = [];

                // --- Basic Validation (Required Fields) ---
                for (const field of REQUIRED_FIELDS) {
                    // Check if the key exists and the value is not null/undefined/empty string
                    if (!(field in row) || row[field as keyof ExcelRowData] == null || String(row[field as keyof ExcelRowData]).trim() === '') {
                        rowErrors.push({ row: rowNum, field, message: 'Required field is missing or empty.' });
                        isValid = false;
                    }
                }
                if (!isValid) {
                    results.validationErrors.push(...rowErrors);
                    continue;
                }

                // --- Data Type & Format Validation ---
                const crime_id = String(row.CrimeID).trim();
                let parsedDate: Date | undefined;
                let parsedTime = String(row.Time).trim();
                let parsedDayOfWeek = String(row.DayOfWeek).trim();
                let parsedCaseStatus = row.CaseStatus ? String(row.CaseStatus).trim() as any : undefined;
                let parsedIndoorsOutdoors = row.IndoorsOrOutdoors ? String(row.IndoorsOrOutdoors).trim() as any : undefined;
                let parsedEventProximity = row.EventProximity ? String(row.EventProximity).trim() : undefined;

                // Date
                parsedDate = parseImportedDate(row.Date) || undefined;
                if (!parsedDate) {
                    rowErrors.push({ row: rowNum, field: 'Date', message: 'Invalid date format.', value: row.Date });
                    isValid = false;
                }

                // Enums (CaseStatus, IndoorsOrOutdoors)
                const validStatuses = ["Ongoing", "Resolved", "Pending"];
                if (parsedCaseStatus && !validStatuses.includes(parsedCaseStatus)) {
                    rowErrors.push({ row: rowNum, field: 'CaseStatus', message: `Invalid value. Must be one of: ${validStatuses.join(', ')}`, value: row.CaseStatus });
                    isValid = false;
                }
                const validSettings = ["Indoors", "Outdoors"];
                 if (parsedIndoorsOutdoors && !validSettings.includes(parsedIndoorsOutdoors)) {
                    rowErrors.push({ row: rowNum, field: 'IndoorsOrOutdoors', message: `Invalid value. Must be 'Indoors' or 'Outdoors'`, value: row.IndoorsOrOutdoors });
                    isValid = false;
                }

                // --- Find/Create Related Documents ---
                let locationId: string | null = null;
                let crimeTypeId: string | null = null;

                if (isValid) {
                    // Location
                    const locData = {
                        house_building_number: row.HouseBuildingNumber ? String(row.HouseBuildingNumber).trim() : undefined,
                        street_name: row.StreetName ? String(row.StreetName).trim() : undefined,
                        purok_block_lot: row.PurokBlockLot ? String(row.PurokBlockLot).trim() : undefined,
                        barangay: String(row.Barangay).trim(),
                        municipality_city: String(row.MunicipalityCity).trim(),
                        province: String(row.Province).trim(),
                        zip_code: row.ZipCode ? String(row.ZipCode).trim() : undefined,
                        region: String(row.Region).trim(),
                    };
                    locationId = await findOrCreateLocation(locData /*, session*/);
                    if (!locationId) {
                        rowErrors.push({ row: rowNum, field: 'Location', message: 'Failed to find or create location document.' });
                        isValid = false;
                    }

                    // Crime Type // <<< UPDATED TO USE findOrCreateCrimeType
                    const crimeTypeName = String(row.CrimeType).trim();
                    const crimeCategory = String(row.CrimeCategory).trim(); // Get category from row
                    crimeTypeId = await findOrCreateCrimeType(crimeTypeName, crimeCategory /*, session*/); // Use new function
                    if (!crimeTypeId) {
                        // Error message updated slightly as creation was attempted
                        rowErrors.push({ row: rowNum, field: 'CrimeType/Category', message: `Failed to find or create Crime Type '${crimeTypeName}' with Category '${crimeCategory}'.`, value: `${row.CrimeType} / ${row.CrimeCategory}` });
                        isValid = false;
                    }
                }

                // --- Categorize Row ---
                const isDuplicate = existingCrimeIds.has(crime_id);

                if (!isValid) {
                    if (isDuplicate) {
                        results.duplicateValidationErrors.push(...rowErrors);
                    } else {
                        results.validationErrors.push(...rowErrors);
                    }
                    continue;
                }

                const processedData: ProcessedReportInfo = {
                    row: rowNum,
                    crime_id: crime_id,
                    date: parsedDate!,
                    time: parsedTime,
                    day_of_week: parsedDayOfWeek,
                    case_status: parsedCaseStatus,
                    event_proximity: parsedEventProximity,
                    crime_occurred_indoors_or_outdoors: parsedIndoorsOutdoors,
                    locationId: locationId!,
                    crimeTypeId: crimeTypeId!,
                    excelData: row,
                };

                if (isDuplicate) {
                    results.potentialUpdates.push(processedData);
                    console.log(`Row ${rowNum}: Identified as potential update for CrimeID: ${crime_id}`);
                } else {
                    results.validNewReports.push(processedData);
                    console.log(`Row ${rowNum}: Identified as valid new report: ${crime_id}`);
                }

            } // End row loop

            // Optional: Commit transaction
            // await session.commitTransaction();

        } catch (procError: any) {
            // Optional: Abort transaction
            // await session.abortTransaction();
            console.error('Import Error: Unhandled exception during row processing.', procError);
            throw procError;
        } finally {
            // Optional: End session
            // await session.endSession();
        }

        console.log("Crime report import analysis complete.");
        console.log(` - New Reports: ${results.validNewReports.length}`);
        console.log(` - Potential Updates: ${results.potentialUpdates.length}`);
        console.log(` - Validation Errors (New): ${results.validationErrors.length}`);
        console.log(` - Validation Errors (Duplicates): ${results.duplicateValidationErrors.length}`);

        // 5. Return Analysis Results
        return NextResponse.json(results, { status: 200 });

    } catch (error: any) {
        console.error('Import Error: Top-level handler caught error.', error);
        return NextResponse.json({ message: `An unexpected error occurred during import analysis: ${error.message}` }, { status: 500 });
    }
}
