import { NextResponse, NextRequest } from "next/server";
import connectDB from "@/lib/mongodb";
import CrimeReport from "@/models/CrimeReports";
import Location, { ILocation } from "@/models/location";
import CrimeType from "@/models/CrimeType";
import { requireRole } from "@/middleware/authMiddleware";
import { isPSGCCode } from "@/app/utils/ispsgc";
import { fetchCoordinates } from "@/app/utils/geocoder";
import mongoose from "mongoose";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// --- GET Handler ---
export async function GET(req: NextRequest, { params }: RouteContext) {
  await connectDB();

  const roleCheck = await requireRole(req, ["admin", "user"]);
  if (roleCheck) return roleCheck;

  const { id } = await params;

  try {
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        console.error(`Invalid Crime Report ID received: ${id}`);
        return NextResponse.json({ error: "Invalid Crime Report ID format" }, { status: 400 });
    }

    console.log(`Fetching report with ID: ${id}`);

    // Find the crime report and populate references
  
    const crimeReport = await CrimeReport.findById(id)
      .populate("location") // Populates the location field with the Location document
      .populate("crime_type"); // Populates the crime_type field with the CrimeType document


    if (!crimeReport) {
      return NextResponse.json({ error: "Crime Report not found" }, { status: 404 });
    }

  
    // Use .toObject() to convert the Mongoose document to a plain object
    const reportObject = crimeReport.toObject();

    const responseData = {
        ...reportObject, // Spread the plain object
        crime_type_data: reportObject.crime_type, // Access populated data

    };
    // Ensure the original ObjectId reference isn't sent if you only want the populated data under crime_type_data
    delete responseData.crime_type;

    return NextResponse.json({ data: responseData }, { status: 200 });

  } catch (error) {
    console.error("Error fetching Crime Report:", error);
     if (error instanceof mongoose.Error.CastError) {
        return NextResponse.json({ error: `Invalid ID format: ${id}` }, { status: 400 });
     }
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

// --- PUT Handler --- 
export async function PUT(
  req: NextRequest,
  { params }: RouteContext
) {
  await connectDB();

  // --- FIX: Clone the request before passing it to middleware ---

  const reqCloneForAuth = req.clone();
  const roleCheck = await requireRole(reqCloneForAuth, ["admin"]);


  if (roleCheck) return roleCheck;

  const { id: crimeReportId } = await params;

  try {
    // Now, read the body from the *original* request object.

    const body = await req.json();

    // ---  PUT handler logic ---

    if (!crimeReportId || !mongoose.Types.ObjectId.isValid(crimeReportId)) {
        console.error(`Invalid Crime Report ID for update: ${crimeReportId}`);
        return NextResponse.json({ error: "Invalid Crime Report ID format" }, { status: 400 });
    }

    const existingCrimeReport = await CrimeReport.findById(crimeReportId);
    if (!existingCrimeReport) {
      return NextResponse.json(
        { error: "Crime Report not found" },
        { status: 404 }
      );
    }

    const crimeReportUpdateData: any = { ...body };

    // --- Handle Location Update ---
    const locationDoc = await Location.findById(existingCrimeReport.location);
    if (!locationDoc) {
        console.error(`Location document not found for ID: ${existingCrimeReport.location}, associated with CrimeReport ${crimeReportId}`);
        return NextResponse.json({ error: "Associated location data not found. Cannot update." }, { status: 404 });
    }

    const locationFieldsToUpdate: Partial<ILocation> = {};
    if (body.house_building_number !== undefined) locationFieldsToUpdate.house_building_number = body.house_building_number;
    if (body.street_name !== undefined) locationFieldsToUpdate.street_name = body.street_name;
    if (body.purok_block_lot !== undefined) locationFieldsToUpdate.purok_block_lot = body.purok_block_lot;
    if (body.barangay_name !== undefined) locationFieldsToUpdate.barangay = body.barangay_name;
    if (body.municipality_city_name !== undefined) locationFieldsToUpdate.municipality_city = body.municipality_city_name;
    if (body.province_name !== undefined) locationFieldsToUpdate.province = body.province_name;
    if (body.region_name !== undefined) locationFieldsToUpdate.region = body.region_name;
    if (body.zip_code !== undefined) locationFieldsToUpdate.zip_code = body.zip_code;

    locationDoc.set(locationFieldsToUpdate);
    const savedLocation = await locationDoc.save();
    console.log(`Location ${savedLocation._id} saved. Pre-save hook executed. New coords (if changed): Lat ${savedLocation.latitude}, Lon ${savedLocation.longitude}`);

    // --- Handle Crime Type Update ---
    let crimeTypeId = existingCrimeReport.crime_type;
    // ... (rest of crime type logic) ...
    if (body.crime_type && typeof body.crime_type === 'string' && body.crime_type !== existingCrimeReport.crime_type?.toString()) {
        let crimeTypeDoc = await CrimeType.findOne({ crime_type: new RegExp(`^${body.crime_type}$`, 'i') });
        if (!crimeTypeDoc) {
            if (!body.crime_type_category || typeof body.crime_type_category !== 'string') {
                return NextResponse.json({ error: "Crime type category is required when specifying a new crime type name." }, { status: 400 });
            }
            console.log(`Creating new CrimeType: ${body.crime_type} with category ${body.crime_type_category}`);
            try {
                crimeTypeDoc = await CrimeType.create({
                    crime_type: body.crime_type,
                    crime_type_category: body.crime_type_category,
                });
            } catch (createError: any) {
                 console.error("Error creating new CrimeType:", createError);
                 if (createError instanceof mongoose.Error.ValidationError) {
                    return NextResponse.json({ error: `Validation Error creating CrimeType: ${createError.message}` }, { status: 400 });
                 }
                 return NextResponse.json({ error: "Failed to create new crime type" }, { status: 500 });
            }
        }
        crimeTypeId = crimeTypeDoc._id;
    } else if (body.crime_type && typeof body.crime_type === 'object' && body.crime_type._id) {
        crimeTypeId = body.crime_type._id;
    }
    crimeReportUpdateData.crime_type = crimeTypeId;


    // --- Clean up CrimeReport Update Data ---
    const fieldsToRemove = [
        'location', 'house_building_number', 'street_name', 'purok_block_lot',
        'barangay', 'municipality_city', 'province', 'region', 'zip_code',
        'barangay_name', 'municipality_city_name', 'province_name', 'region_name',
        'latitude', 'longitude', 'crime_type_category',
        '_id', 'createdAt', 'updatedAt', '__v'
    ];
    fieldsToRemove.forEach(field => delete crimeReportUpdateData[field]);

    // --- Update Crime Report Document ---
    console.log("Cleaned data for CrimeReport update:", JSON.stringify(crimeReportUpdateData, null, 2));
    const updatedCrimeReport = await CrimeReport.findByIdAndUpdate(
      crimeReportId,
      { $set: crimeReportUpdateData },
      { new: true, runValidators: true, context: 'query' }
    )
      .populate("location")
      .populate("crime_type");

    if (!updatedCrimeReport) {
         return NextResponse.json({ error: "Failed to update crime report after location/type updates. Report might have been deleted." }, { status: 404 });
    }

    return NextResponse.json(
      { message: "Crime Report Updated!", data: updatedCrimeReport.toObject() },
      { status: 200 }
    );

  } catch (error: any) {
    console.error("Error updating Crime Report:", error);
    // Add specific check for JSON parsing errors which might occur if the body was already read
    if (error instanceof TypeError && error.message.includes("already been read")) {
        console.error("Attempted to read request body multiple times.");
        // Return a more specific error message if desired
        return NextResponse.json({ error: "Internal server error processing request body." }, { status: 500 });
    }
     if (error instanceof mongoose.Error.CastError) {
        return NextResponse.json({ error: `Invalid ID format provided.` }, { status: 400 });
     }
     if (error instanceof mongoose.Error.ValidationError) {
        const errors = Object.values(error.errors).map(el => el.message);
        return NextResponse.json({ error: `Validation Error: ${errors.join(', ')}` }, { status: 400 });
     }
    if (error instanceof SyntaxError) { // This catches errors during the initial req.json() parse
        return NextResponse.json({ error: "Invalid JSON in request body" }, { status: 400 });
    }
    if (error.message.includes('Failed to geocode address')) {
        return NextResponse.json({ error: "Failed to geocode the provided address. Please check the address details." }, { status: 400 });
    }
    return NextResponse.json({ error: "Database error during update" }, { status: 500 });
  }
}


 // --- DELETE Handler --- 
export async function DELETE(req: NextRequest, { params }: RouteContext) {
    await connectDB(); // Connect DB for DELETE

    const roleCheck = await requireRole(req, ["admin"]);
    if (roleCheck) return roleCheck;

  const { id: crimeReportId } = await params;

  try {
    // --- ID Validation --- (NEW)
    if (!crimeReportId || !mongoose.Types.ObjectId.isValid(crimeReportId)) {
        console.error(`Invalid Crime Report ID for delete: ${crimeReportId}`);
        return NextResponse.json({ error: "Invalid Crime Report ID format" }, { status: 400 });
    }
    // --- End ID Validation ---

    // Find and delete Crime Report
    const crimeReport = await CrimeReport.findByIdAndDelete(crimeReportId);
    if (!crimeReport) {
      return NextResponse.json({ error: "Crime Report not found" }, { status: 404 });
    }

    // --- Cleanup Logic ---
    // Check if any other reports reference the same crime type
    const isCrimeTypeUsed = await CrimeReport.exists({ crime_type: crimeReport.crime_type });
    if (!isCrimeTypeUsed) {
      console.log(`Deleting unused CrimeType: ${crimeReport.crime_type}`);
      await CrimeType.findByIdAndDelete(crimeReport.crime_type);
    }

    // Check if any other reports reference the same location
    const isLocationUsed = await CrimeReport.exists({ location: crimeReport.location });
    if (!isLocationUsed) {
      console.log(`Deleting unused Location: ${crimeReport.location}`);
      await Location.findByIdAndDelete(crimeReport.location);
    }
    // --- End Cleanup Logic ---

    return NextResponse.json(
      { message: "Crime Report Deleted!" },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error Deleting Crime Report:", error);
     if (error instanceof mongoose.Error.CastError) {
        return NextResponse.json({ error: `Invalid ID format provided.` }, { status: 400 });
     }
    return NextResponse.json(
      { error: "Database Error during delete" },
      { status: 500 }
    );
  }
}
