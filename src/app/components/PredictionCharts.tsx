// src/app/components/PredictionCharts.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { buildPythonApiUrl } from "@/app/utils/pythonApi";

// Define props for the PredictionCharts component
interface PredictionChartsProps {
  endpointPath: string; // e.g., '/api/forecast/crime-trend' or '/api/forecast/top-locations'
  className?: string;
  title?: string; // Optional title for the chart container
}

const PredictionCharts: React.FC<PredictionChartsProps> = ({
  endpointPath,
  className = "",
  title = "Prediction Chart", // Default title
}) => {
  const [iframeKey, setIframeKey] = useState(() => Date.now());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartUrl, setChartUrl] = useState<string | undefined>(undefined); // Renamed from mapUrl

  // Function to construct the full URL for the iframe source
  const constructUrl = useCallback((): string | null => {
    try {
      if (!endpointPath) {
        console.warn("PredictionCharts: Endpoint path is missing.");
        return null;
      }
      return buildPythonApiUrl(endpointPath);
    } catch (err) {
      console.error("PredictionCharts: Invalid URL construction:", err);
      return null;
    }
  }, [endpointPath]); // Dependency: endpointPath

  // Effect to update the chart URL and key when the endpointPath changes
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setChartUrl(undefined); // Clear previous URL

    const url = constructUrl(); // Get the URL

    if (url) {
      setChartUrl(url); // Set the new URL for the iframe
      setIframeKey(Date.now()); // Update key to force iframe reload
      console.log(`PredictionCharts: Set URL to ${url}`);
    } else {
      // Handle invalid URL construction
      setError("Invalid chart endpoint configuration or API URL.");
      setIsLoading(false);
    }

  }, [endpointPath, constructUrl]); // Dependencies: endpointPath and the memoized constructUrl function

  // Handler for when the iframe successfully loads its content
  const handleIframeLoad = () => {
    if (chartUrl) { // Only act if we expect a URL to be loaded
        console.log(`PredictionCharts: Iframe loaded successfully for ${endpointPath}`);
        setIsLoading(false);
        setError(null);
    }
  };

  // Handler for when the iframe fails to load its content
  const handleIframeError = () => {
    if (chartUrl) { // Only act if we were trying to load a URL
        console.error(`PredictionCharts: Failed to load iframe source: ${chartUrl}`);
        setIsLoading(false);
        setError("Failed to load chart content. Check connection/configuration or if the prediction server is running.");
        setChartUrl(undefined); // Clear the URL on error
    }
  };

  // Handler for the retry button
  const handleRetry = () => {
    setIsLoading(true);
    setError(null);
    setChartUrl(undefined); // Clear URL

    const url = constructUrl(); // Attempt to get URL again

    if (url) {
      setChartUrl(url); // Set URL for iframe
      setIframeKey(Date.now()); // Force reload
      console.log(`PredictionCharts: Retrying load for ${url}`);
    } else {
      // Handle invalid URL construction on retry
      setError("Invalid chart endpoint configuration or API URL.");
      setIsLoading(false);
    }
  };

  return (
    // Main container div
    <div className={`flex flex-col h-full ${className}`}>
        {/* Chart Container */}
        {/* Use flex-grow to allow the container to fill available vertical space */}
        {/* Set a minimum height to prevent collapse when loading/error */}
        <div className="relative w-full flex-grow min-h-[400px]"> {/* Adjust min-height as needed */}
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
                    Loading prediction chart...
                </div>
                </div>
            )}

            {/* Error message overlay */}
            {!isLoading && error && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 z-10 p-4">
                <div className="text-center text-red-600">
                    <p className="font-semibold mb-2">⚠️ Chart Loading Error</p>
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

            {/* Iframe to display the chart */}
            {/* Render iframe only if URL is set and there's no error */}
            {chartUrl && !error && (
                <iframe
                key={iframeKey} // Force re-render when key changes
                src={chartUrl}
                className="w-full h-full border-none" // Ensure iframe fills its container
                onLoad={handleIframeLoad}
                onError={handleIframeError}
                title={title} // Use the passed title or default
                loading="lazy" // Lazy load the iframe content
                allowFullScreen // Optional: allow fullscreen mode
                referrerPolicy="strict-origin-when-cross-origin" // Recommended security policy
                />
            )}
        </div>
        {/* No legend section needed for these charts based on current setup */}
    </div>
  );
};

export default PredictionCharts;
