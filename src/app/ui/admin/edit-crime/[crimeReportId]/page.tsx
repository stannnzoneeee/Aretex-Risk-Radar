"use client";

import { use, useState, useEffect, useRef } from "react";
import { fetchCoordinates } from "@/app/utils/geocoder";
import { isPSGCCode } from "@/app/utils/ispsgc";
import LocationDropdown from "@/app/components/LocationDropdown";
import { useRouter } from "next/navigation";
import Button from "@/app/components/Button";
import Swal from 'sweetalert2'; // Import SweetAlert2

// --- Define consistent input/select styling ---
const inputFieldStyles = "block w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500 text-sm";
const labelStyles = "block text-gray-700 text-sm font-bold mb-1";
const selectStyles = `${inputFieldStyles} bg-white`;

// Debounce function (remains the same)
function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

// CrimeReport interface (remains the same)
interface CrimeReport {
  _id: string;
  crime_id: string;
  date: string;
  time: string;
  region: string;
  province: string;
  municipality_city: string;
  barangay: string;
  region_name?: string;
  province_name?: string;
  municipality_city_name?: string;
  barangay_name?: string;
  latitude: string | number;
  longitude: string | number;
  crime_type: string;
  crime_type_category: string;
  case_status: string;
  event_proximity: string;
  crime_occurred_indoors_or_outdoors: string;
  house_building_number: string;
  street_name: string;
  purok_block_lot: string;
  zip_code: string;
  day_of_week: string;
  location?: {
    _id: string;
    house_building_number: string;
    street_name: string;
    purok_block_lot: string;
    barangay: string;
    municipality_city: string;
    province: string;
    zip_code: string;
    region: string;
    latitude: number;
    longitude: number;
    region_name?: string;
    province_name?: string;
    municipality_city_name?: string;
    barangay_name?: string;
  };
  crime_type_data?: {
    _id: string;
    crime_type: string;
    crime_type_category: string;
  };
}

interface EditCrimeReportPageProps {
  params: Promise<{
    crimeReportId: string;
  }>;
}

export default function EditCrimeReportPage({ params }: EditCrimeReportPageProps) {
  const { crimeReportId } = use(params);

  // --- Component State and Logic ---
  const [formData, setFormData] = useState<Partial<CrimeReport>>({});
  const [isFetchingCoordinates, setIsFetchingCoordinates] = useState(false);
  const [previousFullAddress, setPreviousFullAddress] = useState("");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true); // For initial data load
  const [isSubmitting, setIsSubmitting] = useState(false); // For form submission
  const [initialLoadError, setInitialLoadError] = useState<string | null>(null); // Separate state for initial load error

  // --- useEffect to fetch data ---
  useEffect(() => {
    if (!crimeReportId || !/^[0-9a-fA-F]{24}$/.test(crimeReportId)) {
      console.error("Invalid crimeReportId format:", crimeReportId);
      setInitialLoadError("Invalid Crime Report ID provided in URL."); // Use specific state
      setIsLoading(false);
      return;
    }

    const fetchCrimeReport = async () => {
      setIsLoading(true);
      setInitialLoadError(null); // Clear previous load error
      try {
        const response = await fetch(`/api/crime-reports/${crimeReportId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || `HTTP error! status: ${response.status}`;
          if (response.status === 404) setInitialLoadError(`Crime report not found (ID: ${crimeReportId}).`);
          else setInitialLoadError(`Failed to load crime report: ${errorMessage}`);
          throw new Error(errorMessage);
        }
        const data = await response.json();
        if (data && data.data) {
          const crimeReport: CrimeReport = data.data;
          const formattedDate = crimeReport.date ? new Date(crimeReport.date).toISOString().split("T")[0] : "";
          const initialFormData: Partial<CrimeReport> = {
            _id: crimeReport._id,
            crime_id: crimeReport.crime_id,
            date: formattedDate,
            time: crimeReport.time,
            region: crimeReport.location?.region,
            province: crimeReport.location?.province,
            municipality_city: crimeReport.location?.municipality_city,
            barangay: crimeReport.location?.barangay,
            region_name: crimeReport.location?.region_name || crimeReport.location?.region,
            province_name: crimeReport.location?.province_name || crimeReport.location?.province,
            municipality_city_name: crimeReport.location?.municipality_city_name || crimeReport.location?.municipality_city,
            barangay_name: crimeReport.location?.barangay_name || crimeReport.location?.barangay,
            latitude: crimeReport.location?.latitude,
            longitude: crimeReport.location?.longitude,
            crime_type: crimeReport.crime_type_data?.crime_type,
            crime_type_category: crimeReport.crime_type_data?.crime_type_category,
            case_status: crimeReport.case_status,
            event_proximity: crimeReport.event_proximity,
            crime_occurred_indoors_or_outdoors: crimeReport.crime_occurred_indoors_or_outdoors,
            house_building_number: crimeReport.location?.house_building_number,
            street_name: crimeReport.location?.street_name,
            purok_block_lot: crimeReport.location?.purok_block_lot,
            zip_code: crimeReport.location?.zip_code,
            day_of_week: crimeReport.day_of_week,
          };
          setFormData(initialFormData);
          console.log("Initial FormData Codes:", { region: initialFormData.region, province: initialFormData.province, municipality_city: initialFormData.municipality_city, barangay: initialFormData.barangay });
          const initialAddressParts = [
            crimeReport.location?.house_building_number, crimeReport.location?.street_name, crimeReport.location?.purok_block_lot,
            initialFormData.barangay_name, initialFormData.municipality_city_name, initialFormData.province_name,
            crimeReport.location?.zip_code, initialFormData.region_name,
          ];
          setPreviousFullAddress(initialAddressParts.filter(Boolean).join(", ").trim());
        } else {
          setInitialLoadError("Failed to parse crime report data from API.");
        }
      } catch (fetchError: any) {
        if (!initialLoadError) setInitialLoadError(`An unexpected error occurred while fetching data: ${fetchError.message}`);
      } finally {
        setIsLoading(false);
      }
    };
    fetchCrimeReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crimeReportId]); // Only run when crimeReportId changes

  // --- Handlers (handleChange, handleLocationSelect, fetchAndSetCoordinates, debouncedFetchCoordinates remain the same) ---
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (["house_building_number", "street_name", "purok_block_lot", "zip_code"].includes(name)) {
      debouncedFetchCoordinates();
    }
  };

  const handleLocationSelect = (name: string, value: string, nameValue: string) => {
    let resetFields: Partial<CrimeReport> = {};
    if (name === 'region') resetFields = { province: '', province_name: '', municipality_city: '', municipality_city_name: '', barangay: '', barangay_name: '' };
    else if (name === 'province') resetFields = { municipality_city: '', municipality_city_name: '', barangay: '', barangay_name: '' };
    else if (name === 'municipality_city') resetFields = { barangay: '', barangay_name: '' };
    setFormData((prev) => ({ ...prev, [name]: value, [`${name}_name`]: nameValue, ...resetFields }));
    debouncedFetchCoordinates();
  };

  const fetchAndSetCoordinates = async () => {
    setIsFetchingCoordinates(true);
    const addressParts = [
      formData.house_building_number, formData.street_name, formData.purok_block_lot,
      formData.barangay_name, formData.municipality_city_name, formData.province_name,
      formData.zip_code, formData.region_name,
    ];
    let fullAddress = addressParts.filter(Boolean).join(", ").trim();
    console.log("Attempting geocoding for address:", fullAddress);
    const hasPSGCCode = formData.region || formData.province || formData.municipality_city || formData.barangay;
    const hasSpecificAddress = formData.house_building_number || formData.street_name || formData.purok_block_lot;
    if (hasPSGCCode && !hasSpecificAddress) {
      console.log("Skipping geocoding: PSGC selected but no specific address details provided.");
    } else if (fullAddress && fullAddress !== previousFullAddress) {
      try {
        const coordinates = await fetchCoordinates(fullAddress);
        console.log("Geocoding result:", coordinates);
        if (coordinates && typeof coordinates.latitude === 'number' && typeof coordinates.longitude === 'number') {
          setFormData((prev) => ({ ...prev, latitude: coordinates.latitude, longitude: coordinates.longitude }));
        } else {
          console.warn("Geocoding did not return valid coordinates for:", fullAddress);
        }
      } catch (geoError) { console.error("Error during geocoding:", geoError); }
    } else if (!fullAddress) console.log("Skipping geocoding: Address is empty.");
    else console.log("Skipping geocoding: Address unchanged.");
    setPreviousFullAddress(fullAddress);
    setIsFetchingCoordinates(false);
  };

  const debouncedFetchCoordinates = useRef(debounce(fetchAndSetCoordinates, 700)).current;

  // --- UPDATED handleSubmit with SweetAlert ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Removed setError and setSuccess

    if (!crimeReportId || !/^[0-9a-fA-F]{24}$/.test(crimeReportId)) {
      Swal.fire({
        icon: 'error',
        title: 'Invalid ID',
        text: 'Cannot update report due to an invalid ID.',
      });
      setIsSubmitting(false);
      return;
    }

    // Add more validation as needed
    if (!formData.crime_id || !formData.date || !formData.time || !formData.crime_type) {
        Swal.fire({
            icon: 'error',
            title: 'Missing Information',
            text: 'Please fill in all required Crime Details (*).',
        });
        setIsSubmitting(false);
        return;
    }
    if (!formData.region || !formData.province || !formData.municipality_city || !formData.barangay) {
        Swal.fire({
            icon: 'error',
            title: 'Missing Location',
            text: 'Please select the full location (Region, Province, Municipality/City, Barangay).',
        });
        setIsSubmitting(false);
        return;
    }

    console.log("Submitting Form Data:", JSON.stringify(formData, null, 2));
    try {
      const response = await fetch(`/api/crime-reports/${crimeReportId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const result = await response.json();

      if (response.ok) {
        // Show success alert
        Swal.fire({
          icon: 'success',
          title: 'Updated!',
          text: 'Crime report updated successfully!',
          timer: 1500, // Auto close
          showConfirmButton: false,
        }).then(() => {
          // Redirect after the alert closes
          router.push("/ui/admin/view-crime");
        });
      } else {
        // Handle specific errors or general failure
        const errorMessage = result.error || 'Unknown error during update.';
        throw new Error(errorMessage);
      }
    } catch (submitError: any) {
      console.error("Error submitting update:", submitError);
      // Show error alert
      Swal.fire({
        icon: 'error',
        title: 'Update Failed',
        text: `Update failed: ${submitError.message || 'Network error'}`,
      });
    } finally {
        setIsSubmitting(false); // Clear submitting state
    }
  };
  // --- END UPDATED handleSubmit ---

  // --- Render Logic ---
  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-32">
        <div className="loader border-t-4 border-blue-500 rounded-full w-12 h-12 animate-spin"></div>
      </div>
    );
  }

  // Display initial load error prominently if it occurred
  if (initialLoadError && !formData._id) {
    return (
        <div className="bg-white rounded-lg shadow-md p-6 border border-red-300 max-w-3xl mx-auto mt-10">
            <h2 className="text-xl font-semibold mb-4 text-red-700">Error Loading Report</h2>
            <p className="text-red-600">{initialLoadError}</p>
            <div className="mt-6 flex justify-end">
                <Button variant="back" onClick={() => router.back()}>
                    Go Back
                </Button>
            </div>
        </div>
    );
  }

  // --- JSX Form ---
  return (
    <div className="bg-white rounded-lg shadow-md p-6 border border-gray-200 max-w-3xl mx-auto">
       <button
            onClick={() => router.back()}
            className="mb-4 text-sm text-blue-600 hover:text-blue-800 flex items-center"
        >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Crime Reports
        </button>

      {/* Title */}
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        Edit Crime Report <span className="text-sm font-normal text-gray-500"></span>
      </h1>

      {/* Removed submission error/success message display */}
      {/* {error && <p className="mb-4 text-center text-sm text-red-700 bg-red-50 p-3 rounded-md">{error}</p>} */}
      {/* {success && <p className="mb-4 text-center text-sm text-green-700 bg-green-50 p-3 rounded-md">{success}</p>} */}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Crime Details Section (remains the same) */}
        <fieldset className="border border-gray-200 rounded-lg p-4">
          <legend className="text-lg font-semibold px-2 text-gray-700">Crime Details</legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div>
              <label htmlFor="crime_id" className={labelStyles}>Crime ID <span className="text-red-500">*</span></label>
              <input id="crime_id" type="text" name="crime_id" value={formData.crime_id || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="date" className={labelStyles}>Date <span className="text-red-500">*</span></label>
              <input id="date" type="date" name="date" value={formData.date || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="time" className={labelStyles}>Time <span className="text-red-500">*</span></label>
              <input id="time" type="time" name="time" value={formData.time || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="day_of_week" className={labelStyles}>Day of Week <span className="text-red-500">*</span></label>
              <input id="day_of_week" type="text" name="day_of_week" placeholder="e.g., Monday" value={formData.day_of_week || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="crime_type" className={labelStyles}>Crime Type <span className="text-red-500">*</span></label>
              <input id="crime_type" type="text" name="crime_type" placeholder="e.g., Theft" value={formData.crime_type || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="crime_type_category" className={labelStyles}>Crime Category <span className="text-red-500">*</span></label>
              <input id="crime_type_category" type="text" name="crime_type_category" placeholder="e.g., Property Crime" value={formData.crime_type_category || ""} onChange={handleChange} required className={inputFieldStyles}/>
            </div>
            <div>
              <label htmlFor="case_status" className={labelStyles}>Case Status <span className="text-red-500">*</span></label>
              <select id="case_status" name="case_status" value={formData.case_status || ""} onChange={handleChange} required className={selectStyles}>
                <option value="" disabled>Select Status</option>
                <option value="Ongoing">Ongoing</option>
                <option value="Resolved">Resolved</option>
                <option value="Pending">Pending</option>
              </select>
            </div>
            <div>
              <label htmlFor="event_proximity" className={labelStyles}>Event Proximity</label>
              <input id="event_proximity" type="text" name="event_proximity" placeholder="e.g., Near School" value={formData.event_proximity || ""} onChange={handleChange} className={inputFieldStyles}/>
            </div>
             <div className="md:col-span-2">
              <label htmlFor="crime_occurred_indoors_or_outdoors" className={labelStyles}>Occurred Indoors/Outdoors <span className="text-red-500">*</span></label>
              <select id="crime_occurred_indoors_or_outdoors" name="crime_occurred_indoors_or_outdoors" value={formData.crime_occurred_indoors_or_outdoors || ""} onChange={handleChange} required className={selectStyles}>
                <option value="" disabled>Select Location Type</option>
                <option value="Indoors">Indoors</option>
                <option value="Outdoors">Outdoors</option>
              </select>
            </div>
          </div>
        </fieldset>

       {/* Location Details Section (remains the same) */}
       <fieldset className="border border-gray-200 rounded-lg p-4">
          <legend className="text-lg font-semibold px-2 text-gray-700">Location Details</legend>
          <p className="text-xs text-gray-500 px-2 mb-3">Only re-select dropdowns if the location needs changing.</p>
          <div className="space-y-4 pt-2">
             <LocationDropdown
                onSelect={handleLocationSelect}
                selectedRegionFromParent={formData.region || ""}
                selectedProvinceFromParent={formData.province || ""}
                selectedMunicipalityFromParent={formData.municipality_city || ""}
                selectedBarangayFromParent={formData.barangay || ""}
             />
             <h4 className="font-medium text-gray-600 pt-2">Specific Address</h4>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                 <label htmlFor="house_building_number" className={labelStyles}>House/Bldg No.</label>
                 <input id="house_building_number" type="text" name="house_building_number" value={formData.house_building_number || ""} onChange={handleChange} className={inputFieldStyles}/>
               </div>
               <div>
                 <label htmlFor="street_name" className={labelStyles}>Street Name</label>
                 <input id="street_name" type="text" name="street_name" value={formData.street_name || ""} onChange={handleChange} className={inputFieldStyles}/>
               </div>
               <div>
                 <label htmlFor="purok_block_lot" className={labelStyles}>Purok/Block/Lot</label>
                 <input id="purok_block_lot" type="text" name="purok_block_lot" value={formData.purok_block_lot || ""} onChange={handleChange} className={inputFieldStyles}/>
               </div>
               <div>
                 <label htmlFor="zip_code" className={labelStyles}>Zip Code</label>
                 <input id="zip_code" type="text" name="zip_code" value={formData.zip_code || ""} onChange={handleChange} className={inputFieldStyles}/>
               </div>
             </div>
             <div className="flex items-center justify-start space-x-3 pt-2 min-h-[30px]">
                <span className="text-sm font-medium text-gray-700">Coordinates:</span>
                {isFetchingCoordinates ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-blue-500"></div>
                ) : formData.latitude && formData.longitude ? (
                    <span className="text-sm text-green-600 font-mono">
                    {typeof formData.latitude === 'number' ? formData.latitude.toFixed(6) : formData.latitude}, {typeof formData.longitude === 'number' ? formData.longitude.toFixed(6) : formData.longitude}
                    </span>
                ) : (
                    <span className="text-sm text-gray-500">Not available</span>
                )}
             </div>
          </div>
        </fieldset>

        {/* Action Buttons (remains the same) */}
        <div className="mt-8 pt-6 border-t border-gray-200 flex gap-3 justify-end">
            <Button
                type="button"
                variant="back"
                onClick={() => router.back()}
                disabled={isSubmitting} // Disable while submitting
            >
                Cancel
            </Button>
            <Button
                type="submit"
                variant="submit"
                className="min-w-[140px]" // Adjusted min-width
                isLoading={isSubmitting} // Use isSubmitting for loading state
                disabled={isSubmitting || isLoading || isFetchingCoordinates} // Disable if submitting, initial loading, or fetching coords
            >
                {isSubmitting ? 'Updating...' : 'Update Report'}
            </Button>
        </div>
      </form>
    </div>
  );
}
