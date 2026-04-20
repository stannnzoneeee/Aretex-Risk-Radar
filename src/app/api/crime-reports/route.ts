import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import CrimeReport from "@/models/CrimeReports";
import Location from "@/models/location";
import CrimeType from "@/models/CrimeType";
import Notification from "@/models/Notification"; // Import Notification model
import { requireRole } from "@/middleware/authMiddleware";
import { fetchCoordinates } from "@/app/utils/geocoder";
import { isPSGCCode } from "@/app/utils/ispsgc";
import { getPSGCName } from "@/app/utils/psgcName";
import mongoose from "mongoose";

// Helper to format date/time for notification message
const formatDateTimeForNotification = (date: Date | string, time: string): string => {
    const d = new Date(date);
    const dateString = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    // Basic time formatting, adjust if your time format is different
    return `${dateString} at ${time}`;
}
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;


// GET: Fetch Crime Reports with all filters and searches
export async function GET(req: NextRequest) {
  try {
    const roleCheck = await requireRole(req, ["admin"]);
    if (roleCheck) return roleCheck;

    await connectDB();

    const { searchParams } = req.nextUrl;
    const limit = parseInt(searchParams.get("limit") || "12");
    const skip = parseInt(searchParams.get("skip") || "0");
    // Filters
    const caseStatus = searchParams.get("case_status");
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");
    // Search terms
    const searchCrimeType = searchParams.get("search_crime_type");
    const searchLocation = searchParams.get("search_location");
    const searchCrimeId = searchParams.get("search_crime_id"); // <-- Get Crime ID search term

    const query: any = {}; // Main query object for CrimeReport

    // --- Start: Crime ID Search Logic
    if (searchCrimeId) {
      console.log("Searching for crime ID matching:", searchCrimeId);
      // Since crime_id is a String, use regex for partial, case-insensitive matching.
      // For an exact match, use: query.crime_id = searchCrimeId;
      query.crime_id = { $regex: new RegExp(searchCrimeId, "i") };
    }
    // --- End: Crime ID Search Logic ---

    // --- Start: Crime Type Search Logic ---
    if (searchCrimeType) {
      console.log("Searching for crime types matching:", searchCrimeType);
      const matchingCrimeTypes = await CrimeType.find({
        // Also search crime_type_category
        $or: [
            { crime_type: { $regex: new RegExp(searchCrimeType, "i") } },
            { crime_type_category: { $regex: new RegExp(searchCrimeType, "i") } }
        ]
      }).select('_id').lean(); // Use lean for performance

      const crimeTypeIds = matchingCrimeTypes.map(ct => ct._id);
      console.log("Found matching crime type IDs:", crimeTypeIds);

      // If search term provided but no matching types found, make the query impossible
      if (crimeTypeIds.length === 0) {
        console.log("No matching crime types found.");
        // Setting crime_type to an impossible value ensures no results
        query.crime_type = new mongoose.Types.ObjectId();
      } else {
        query.crime_type = { $in: crimeTypeIds };
      }
    }
    // --- End: Crime Type Search Logic ---

    // --- Start: Location Search Logic ---
    if (searchLocation) {
      console.log("Searching for locations matching:", searchLocation);
      const searchRegex = new RegExp(searchLocation, "i"); // Case-insensitive regex

      // Define fields to search within the Location model
      const locationSearchFields = [
        { barangay: searchRegex },
        { municipality_city: searchRegex },
        { province: searchRegex },
        { region: searchRegex },
        { street_name: searchRegex },
        { purok_block_lot: searchRegex },
        { house_building_number: searchRegex }, // Added house number
        { zip_code: searchRegex }, // Added zip code
      ];

      const matchingLocations = await Location.find({
        $or: locationSearchFields // Search across multiple fields
      }).select('_id').lean(); // Use lean

      const locationIds = matchingLocations.map(loc => loc._id);
      console.log("Found matching location IDs:", locationIds);

      // If search term provided but no matching locations found, make query impossible
      if (locationIds.length === 0) {
        console.log("No matching locations found for search term.");
        query.location = new mongoose.Types.ObjectId();
      } else {
        query.location = { $in: locationIds };
      }
    }
    // --- End: Location Search Logic ---

    // --- Add Standard Filters ---
    if (caseStatus) {
      query.case_status = caseStatus;
    }

    // Date range filter (improved validation)
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        if (!isNaN(parsedStartDate.getTime())) {
            query.date.$gte = parsedStartDate;
        } else {
            console.warn("Invalid start_date received:", startDate);
            // Optionally return an error or ignore the invalid date
        }
      }
      if (endDate) {
         const parsedEndDate = new Date(endDate);
         if (!isNaN(parsedEndDate.getTime())) {
            parsedEndDate.setHours(23, 59, 59, 999); // End of the day
            query.date.$lte = parsedEndDate;
         } else {
            console.warn("Invalid end_date received:", endDate);
            // Optionally return an error or ignore the invalid date
         }
      }
      // Remove date filter if it ended up empty due to invalid inputs
      if (Object.keys(query.date).length === 0) {
          delete query.date;
      }
    }
    // --- End: Standard Filters ---

    console.log("Executing CrimeReport query:", JSON.stringify(query, null, 2)); // Log final query

    // Get total count matching the combined query
    const total = await CrimeReport.countDocuments(query);

    // Get the paginated crime reports matching the combined query
    const crimeReports = await CrimeReport.find(query)
      .populate({ path: "location", model: Location }) // Explicitly specify model for population
      .populate({ path: "crime_type", model: CrimeType }) // Explicitly specify model for population
      .sort({ date: -1, time: -1 }) // Sort by date then time, descending
      .limit(limit)
      .skip(skip)
      .lean() // Use lean() for better performance when not modifying docs
      .exec();

    console.log(`Found ${crimeReports.length} reports for this page, total matching: ${total}`);

    return NextResponse.json({ data: crimeReports, total }, { status: 200 });
  } catch (error) {
    console.error("Error Fetching Crime Reports:", error);
    // Provide more context in the error response if possible
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ error: "Database Error", details: errorMessage }, { status: 500 });
  }
}



// Handle POST request
export async function POST(req: Request) {
  await connectDB();

  // Check for admin role
  const roleCheck = await requireRole(req, ["admin"]);
  if (roleCheck) return roleCheck;

  // Check for API key
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("Missing Google Maps API key.");
    return NextResponse.json(
      { error: "Server configuration error: Missing Google Maps API key." },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    console.log("Request Body:", body);

    // --- Start: Duplicate crime_id Check --- (NEW)
    const existingReport = await CrimeReport.findOne({ crime_id: body.crime_id });
    if (existingReport) {
      console.warn(`Attempted to add duplicate crime_id: ${body.crime_id}`);
      return NextResponse.json(
        { error: `Crime report with ID '${body.crime_id}' already exists.` },
        { status: 409 } // 409 Conflict status code
      );
    }
    // --- End: Duplicate crime_id Check ---

    // Input Validation (Check for missing required fields)
    const requiredFields = [
      "crime_id", // Already checked for duplication above
      "date",
      "time",
      "day_of_week",
      "barangay",
      "municipality_city",
      "province",
      "region",
      "crime_type",
      "crime_type_category",
      "case_status",
      "crime_occurred_indoors_or_outdoors",
    ];

    const missingFields = requiredFields.filter((field) => !body[field]);
    console.log("Missing Fields:", missingFields);

    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(", ")}` },
        { status: 400 }
      );
    }

    // Basic address validation
    if (
      !body.barangay &&
      !body.municipality_city &&
      !body.province &&
      !body.region
    ) {
      return NextResponse.json(
        {
          error:
            "At least one of the following location fields must be provided: barangay, municipality_city, province, region.",
        },
        { status: 400 }
      );
    }

   // 1. Fetch Latitude & Longitude (Keep existing logic)
   const addressParts = [
    body.house_building_number,
    body.street_name,
    body.purok_block_lot,
    body.barangay_name,
    body.municipality_city_name,
    body.province_name,
    body.region_name,
  ];
  const fullAddress = addressParts.filter(Boolean).join(", ");

  console.log("Full Address:", fullAddress);

  let latitude: number | undefined = body.latitude ? parseFloat(body.latitude) : undefined;
  let longitude: number | undefined = body.longitude ? parseFloat(body.longitude) : undefined;

  if ((latitude === undefined || longitude === undefined) && !isPSGCCode(fullAddress)) {
    console.log("Attempting to fetch coordinates for:", fullAddress);
    const coordinates = await fetchCoordinates(fullAddress);
    if (coordinates) {
      latitude = coordinates.latitude;
      longitude = coordinates.longitude;
      if (isNaN(latitude) || isNaN(longitude)) {
        console.error("Invalid coordinates received from geocoding API:", coordinates);
        latitude = undefined;
        longitude = undefined;
      }
    } else {
      console.error(
        "fetchCoordinates returned null for address:",
        fullAddress
      );
    }
  }

    // 2. Find or Create Crime Type 
    let crimeType = await CrimeType.findOne({ crime_type: body.crime_type });
    if (!crimeType) {
        crimeType = await CrimeType.create({
        crime_type: body.crime_type,
        crime_type_category: body.crime_type_category,
    });
    }
    const crimeTypeId = crimeType._id;

    // Prepare location data 
    const locationData: any = {
      house_building_number: body.house_building_number,
      street_name: body.street_name,
      purok_block_lot: body.purok_block_lot,
      barangay: body.barangay,
      municipality_city: body.municipality_city,
      province: body.province,
      zip_code: body.zip_code,
      region: body.region,
    };

    if (isPSGCCode(body.region) || isPSGCCode(body.province) || isPSGCCode(body.municipality_city) || isPSGCCode(body.barangay)) {
      locationData.psgc_code = `${body.region}, ${body.province}, ${body.municipality_city}, ${body.barangay}`;
      locationData.barangay_name = body.barangay_name;
      locationData.municipality_city_name = body.municipality_city_name;
      locationData.province_name = body.province_name;
      locationData.region_name = body.region_name;
    }

    if (latitude !== undefined) {
      locationData.latitude = latitude;
    }
    if (longitude !== undefined) {
      locationData.longitude = longitude;
    }

    // 3. Create Location (Keep existing logic)
    const location = await Location.create({
      house_building_number: body.house_building_number,
      street_name: body.street_name,
      purok_block_lot: body.purok_block_lot,
      barangay: body.barangay_name,
      municipality_city: body.municipality_city_name,
      province: body.province_name,
      zip_code: body.zip_code,
      region: body.region_name,
      latitude: latitude,
      longitude: longitude,
    });

    console.log("Location Created:", location);

    // 4. Create Crime Report (Keep existing logic)
    const crime = await CrimeReport.create({
      crime_id: body.crime_id,
      date: body.date,
      time: body.time,
      day_of_week: body.day_of_week,
      location: location._id,
      crime_type: crimeTypeId,
      case_status: body.case_status,
      event_proximity: body.event_proximity,
      crime_occurred_indoors_or_outdoors: body.crime_occurred_indoors_or_outdoors,
    });

    // --- Create Notification for 'all' users ---
    try {
        // Use the actual crime type name and location names for the message
        const locationName = location.barangay || location.municipality_city || 'Unknown Location';
        const dateTimeString = formatDateTimeForNotification(crime.date, crime.time);

        await Notification.create({
            message: `New report submitted: ${crimeType.crime_type} on ${dateTimeString} in ${locationName}.`,
            type: 'new_report_submitted', // <-- Added notification type
            recipientRole: 'all', // Target both admin and user
            link: `/ui/admin/view-crime?highlight=${crime._id}`, // Link for admins (adjust if users have a different view)
            // linkUser: `/ui/view-report/${crime._id}`, // Example for user link (if needed)
            isRead: false,
        });
        console.log("Notification created for new crime report:", crime.crime_id);
    } catch (notificationError) {
        console.error("Failed to create notification for new report:", notificationError);
        // Log the error, but don't fail the main report creation
    }
    // --- End Notification Creation ---
    return NextResponse.json(
      { message: "Crime Report Saved!", data: crime },
      { status: 201 } // 201 Created status code
    );
  } catch (error) {
    // Check specifically for Mongoose duplicate key errors (though our check above is better)
    if (error instanceof Error && (error as any).code === 11000) {
       console.error("Duplicate key error:", error);
       // Extract the duplicate key field if possible
       const field = Object.keys((error as any).keyValue)[0];
       return NextResponse.json({ error: `Duplicate value for ${field}: ${(error as any).keyValue[field]}` }, { status: 409 });
    }

    console.error("Error Saving Crime Report:", error);
    if (error instanceof Error) {
      console.error("Error stack:", error.stack);
    } else {
      console.error("An unknown error occurred:", error);
    }
    return NextResponse.json({ error: "Database Error" }, { status: 500 });
  }
}
