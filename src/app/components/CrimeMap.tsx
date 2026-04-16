// src/app/components/CrimeMap.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { buildPythonApiUrl } from "@/app/utils/pythonApi";

// --- NEW: Interface for Legend Items ---
interface LegendItem {
  color: string; // e.g., 'bg-red-500', 'bg-blue-500'
  label: string; // e.g., 'Open/Ongoing', 'Pending/Under Investigation'
}

interface CrimeMapProps {
  endpointPath: string;
  className?: string;
  legendTitle?: string; // Optional title for the legend
  legendItems?: LegendItem[]; // Optional array of legend items
}

const CrimeMap: React.FC<CrimeMapProps> = ({
  endpointPath,
  className = "",
  legendTitle, // Destructure new props
  legendItems, // Destructure new props
}) => {
  const [iframeKey, setIframeKey] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapUrl, setMapUrl] = useState<string | undefined>(undefined);

  const constructUrl = useCallback((): string | null => {
    try {
      if (!endpointPath) {
        console.warn("CrimeMap: Endpoint path is missing.");
        return null;
      }
      return buildPythonApiUrl(endpointPath);
    } catch (err) {
      console.error("Invalid URL construction:", err);
      return null;
    }
  }, [endpointPath]);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setMapUrl(undefined);

    const url = constructUrl();

    if (url) {
      setMapUrl(url);
      setIframeKey(Date.now());
    } else {
      setError("Invalid map endpoint configuration or API URL.");
      setIsLoading(false);
    }

  }, [endpointPath, constructUrl]);

  const handleIframeLoad = () => {
    if (mapUrl) {
        setIsLoading(false);
        setError(null);
    }
  };

  const handleIframeError = () => {
    if (mapUrl) {
        console.error(`Failed to load iframe source: ${mapUrl}`);
        setIsLoading(false);
        setError("Failed to load map content. Check connection/configuration or if the map server is running.");
        setMapUrl(undefined);
    }
  };

  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setMapUrl(undefined);

    const url = constructUrl();

    if (url) {
      setMapUrl(url);
      setIframeKey(Date.now());
    } else {
      setError("Invalid map endpoint configuration or API URL.");
      setIsLoading(false);
    }
  };

  return (
    // Use flex column to position legend below map container
    <div className={`flex flex-col h-full ${className}`}>
        {/* Map Container */}
        <div className="relative w-full flex-grow min-h-[450px]"> {/* Adjusted min-height */}
            {/* Loading overlay */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-100/50 z-10">
                <div className="text-center text-gray-500">
                    <svg
                    className="animate-spin h-8 w-8 text-gray-400 mx-auto mb-2"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                    </svg>
                    Loading crime map...
                </div>
                </div>
            )}

            {/* Error message */}
            {!isLoading && error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 z-10 p-4">
                <div className="text-center text-red-600">
                    <p className="font-semibold mb-2">⚠️ Map Loading Error</p>
                    <p className="text-sm">{error}</p>
                    <button
                    onClick={handleRetry}
                    className="mt-3 px-4 py-2 text-sm bg-red-100 hover:bg-red-200 rounded-md transition-colors"
                    >
                    Retry Loading
                    </button>
                </div>
                </div>
            )}

            {/* Iframe */}
            {mapUrl && !error && (
                <iframe
                key={iframeKey}
                src={mapUrl}
                className="w-full h-full border-none"
                onLoad={handleIframeLoad}
                onError={handleIframeError}
                title="Crime Map Visualization"
                loading="lazy"
                allow="geolocation"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                />
            )}
        </div>

        {/* --- NEW: Legend Section --- */}
        {/* Render legend only if items are provided and map isn't loading/in error */}
        {!isLoading && !error && mapUrl && legendItems && legendItems.length > 0 && (
            <div className="mt-3 p-3 border border-gray-200 rounded-md bg-white shadow-sm flex-shrink-0">
                {legendTitle && <h4 className="text-sm font-semibold mb-2 text-gray-700">{legendTitle}</h4>}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {legendItems.map((item, index) => (
                        <div key={index} className="flex items-center">
                            <span className={`w-3 h-3 rounded-sm mr-2 ${item.color}`}></span>
                            <span className="text-xs text-gray-600">{item.label}</span>
                        </div>
                    ))}
                </div>
            </div>
        )}
    </div>
  );
};

export default CrimeMap;
