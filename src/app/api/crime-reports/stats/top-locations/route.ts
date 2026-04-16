import { NextRequest, NextResponse } from "next/server";
import connectDB from "@/lib/mongodb";
import CrimeReport from "@/models/CrimeReports"; // Your CrimeReport model
import Location from "@/models/location"; // Your Location model
import mongoose from "mongoose";
import { requireRole } from "@/middleware/authMiddleware"; // Keep authentication

type GroupByField = 'municipality_city' | 'barangay' | 'province';
const ALLOWED_GROUP_BY: GroupByField[] = ['municipality_city', 'barangay', 'province'];

export async function GET(req: NextRequest) {
    await connectDB();

    const roleCheck = await requireRole(req, ["admin"]);
    if (roleCheck) return roleCheck;

    try {
        const { searchParams } = req.nextUrl;

        // --- Parameters ---
        const limitParam = searchParams.get("limit") || "10";
        const groupByParam = searchParams.get("groupBy") as GroupByField | null;
        const yearParam = searchParams.get("year"); // <-- Get the year parameter

        // --- Validate GroupBy ---
        let groupByField: GroupByField = 'municipality_city'; // Default
        if (groupByParam && ALLOWED_GROUP_BY.includes(groupByParam)) {
            groupByField = groupByParam;
        } else if (groupByParam) {
            return NextResponse.json(
                { error: `Invalid 'groupBy' parameter. Allowed values are: ${ALLOWED_GROUP_BY.join(', ')}.` },
                { status: 400 }
            );
        }
        console.log(`Grouping by: ${groupByField}`);

        // --- Validate Year ---
        let selectedYear: number | null = null;
        if (yearParam) {
            const parsedYear = parseInt(yearParam, 10);
            if (!isNaN(parsedYear) && parsedYear > 1900 && parsedYear < 2100) {
                selectedYear = parsedYear;
                console.log(`Filtering by year: ${selectedYear}`);
            } else {
                console.warn(`Invalid 'year' parameter received: ${yearParam}. Ignoring.`);
                // Optional: Return error for invalid year format
                // return NextResponse.json({ error: "Invalid 'year' parameter format." }, { status: 400 });
            }
        }

        // --- Build the initial $match stage ---
        const matchStage: mongoose.FilterQuery<any> = {};

        // --- Add Year Filter to $match stage ---
        if (selectedYear) {
            // Assuming 'date' field in CrimeReport is a Date object
            // Use UTC to avoid timezone issues when comparing dates
            const startDate = new Date(Date.UTC(selectedYear, 0, 1, 0, 0, 0)); // Jan 1st, 00:00:00 UTC
            const endDate = new Date(Date.UTC(selectedYear + 1, 0, 1, 0, 0, 0)); // Jan 1st of next year, 00:00:00 UTC

            matchStage.date = {
                $gte: startDate, // Greater than or equal to the start of the year
                $lt: endDate     // Less than the start of the next year
            };
        }
        // --- End Year Filter ---

        // --- Aggregation Pipeline ---
        const pipeline: mongoose.PipelineStage[] = [
            // 1. Initial Match (includes year filter if provided)
            { $match: matchStage },

            // 2. Lookup Location
            {
                $lookup: {
                    from: Location.collection.name,
                    localField: "location",
                    foreignField: "_id",
                    as: "locationDetails"
                }
            },
            // 3. Unwind Location Details
            {
                $unwind: {
                    path: "$locationDetails",
                    preserveNullAndEmptyArrays: true // Keep reports even if location lookup fails (adjust if needed)
                }
            },
            // 4. Filter out docs with missing/invalid location or grouping field
            {
                $match: {
                    // Ensure the specific grouping field exists and is not null/empty
                    [`locationDetails.${groupByField}`]: { $exists: true, $nin: [null, ""] }
                }
            },
            // 5. Group by the specified location field
            {
                $group: {
                    _id: `$locationDetails.${groupByField}`,
                    count: { $sum: 1 }
                }
            },
            // 6. Sort by count descending
            { $sort: { count: -1 } },
            // 7. Limit the results
            { $limit: parseInt(limitParam, 10) },
            // 8. Project the final output shape
            {
                $project: {
                    _id: 0,
                    locationName: "$_id", // Rename _id to locationName
                    count: 1
                }
            }
        ];
        // --- End Aggregation Pipeline ---

        console.log("Executing Top Locations Pipeline:", JSON.stringify(pipeline, null, 2));

        const topLocations = await CrimeReport.aggregate(pipeline);

        console.log(`Found ${topLocations.length} aggregated top locations (Year: ${selectedYear ?? 'All'}).`);

        return NextResponse.json(topLocations, { status: 200 });

    } catch (error) {
        console.error("--- Error Aggregating Top Locations ---");
        console.error("Error Message:", error instanceof Error ? error.message : error);
        if (process.env.NODE_ENV === 'development' && error instanceof Error) {
            console.error("Stack Trace:", error.stack);
        }
        console.error("---------------------------------------");

        const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
        return NextResponse.json({ error: "Aggregation Error", details: errorMessage }, { status: 500 });
    }
}
