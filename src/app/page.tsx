// src/app/page.tsx
"use client";

import { useState, useEffect, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { FcGoogle } from "react-icons/fc";
import Button from "./components/Button";
import StartupHeader from "./components/StartupHeader";
import Swal from "sweetalert2"; // Import SweetAlert2

function SignInContent() {
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [rememberMe, setRememberMe] = useState(false); // Added for remember me checkbox
  const router = useRouter();
  const searchParams = useSearchParams();

  // --- Helper function for the pending approval alert ---
  const showPendingApprovalAlert = () => {
    Swal.fire({
      icon: "info",
      title: "Pending Approval",
      text: "Your account is waiting for admin approval. Please check back later.",
      confirmButtonColor: "#3085d6",
    });
    // Also set the text error state for consistency
    setError("Your account is pending admin approval.");
  };
  // --- End Helper ---

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam) {
      console.log("SignInPage: Detected error query param:", errorParam);
      if (errorParam === "CredentialsSignin") {
        setError("Invalid email or password.");
        // Optionally show Swal for credentials error here too, if desired
        // Swal.fire({ icon: 'error', title: 'Oops...', text: 'Invalid email or password!' });
      } else if (errorParam === "AccountPending") {
        // *** Updated check for AccountPending ***
        // --- Show SweetAlert for pending approval from URL param ---
        showPendingApprovalAlert();
        // --- End SweetAlert ---
      } else if (errorParam === "AccountRejected") {
        // Handle rejected account from URL
        setError("Your account has been rejected.");
        Swal.fire({
          icon: "error",
          title: "Account Rejected",
          text: "Your account access has been rejected. Please contact support if you believe this is an error.",
        });
      } else if (errorParam === "Callback") {
        setError(
          "There was an issue during the login process. Please try again."
        );
      } else if (errorParam === "OAuthAccountNotLinked") {
        setError(
          "This email is already associated with an account created using a different method. Try logging in with your original method."
        );
        Swal.fire({
          icon: "warning",
          title: "Account Exists",
          text: "This email is already associated with an account created using a different method (e.g., email/password). Please log in using that method.",
        });
      } else {
        setError("An unexpected login error occurred.");
        console.error("Login page error param:", errorParam);
      }
      // Clear the error from the URL to prevent it showing again on refresh
      router.replace("/", undefined); // Use replace to avoid adding to history
    }
  }, [searchParams, router]); // Added router to dependency array

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");

    if (!email || !password) {
      setError("Please enter both email and password.");
      setIsLoading(false);
      return;
    }

    try {
      const finalCallbackUrl = "/"; // Or determine dynamically if needed
      console.log(`SignInPage: Attempting credentials signIn`);

      // Use redirect: false to handle the response directly here
      const response = await signIn("credentials", {
        email: email,
        password: password,
        redirect: false, // Handle response here instead of auto-redirect
      });

      console.log("SignInPage: signIn response:", response);

      if (response?.error) {
        console.error("Sign-in failed:", response.error);
        // Check for specific errors and show alerts
        if (
          response.error === "CredentialsSignin" ||
          response.error === "InvalidCredentials"
        ) {
          // Check for both possible errors
          setError("Invalid email or password.");
          Swal.fire({
            icon: "error",
            title: "Login Failed",
            text: "Invalid email or password!",
          });
        } else if (response.error === "AccountPending") {
          // *** Updated check for AccountPending ***
          // --- Show SweetAlert for pending approval from direct response ---
          showPendingApprovalAlert();
          // --- End SweetAlert ---
        } else if (response.error === "AccountRejected") {
          setError("Your account has been rejected.");
          Swal.fire({
            icon: "error",
            title: "Account Rejected",
            text: "Your account access has been rejected.",
          });
        } else if (response.error === "OAuthAccountNotLinked") {
          setError(
            "This email is linked to a Google account. Please use Google Sign-In."
          );
          Swal.fire({
            icon: "warning",
            title: "Use Google Sign-In",
            text: 'This email address is associated with a Google Sign-In. Please use the "Sign in with Google" button.',
          });
        } else {
          // Handle other errors
          setError("Login failed. Please try again.");
          Swal.fire({
            icon: "error",
            title: "Login Failed",
            text: "An unexpected error occurred during login.",
          });
        }
        setIsLoading(false); // Stop loading on error
      } else if (response?.ok && !response.error && response.url) {
        // Successful sign-in when redirect: false, manually redirect
        console.log(
          "SignInPage: Credentials sign in successful, redirecting..."
        );
        // The response URL might already incorporate middleware redirects
        router.push(response.url);
        // No need to set loading false here as we are navigating away
      } else {
        // Handle unexpected response structure
        console.error("Unexpected signIn response:", response);
        setError("An unexpected issue occurred during login.");
        Swal.fire({
          icon: "error",
          title: "Error",
          text: "An unexpected issue occurred.",
        });
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Exception during credentials sign in:", err);
      setError("An exception occurred during sign in.");
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "An exception occurred during sign in.",
      });
      setIsLoading(false);
    }
  }

  const handleGoogleSignIn = async () => {
    setError("");
    setIsGoogleLoading(true);
    try {
      const finalCallbackUrl = "/"; // Or determine dynamically
      console.log(`SignInPage: Attempting Google signIn`);

      // Use redirect: false to catch errors directly
      const response = await signIn("google", {
        callbackUrl: finalCallbackUrl,
        redirect: false, // Catch errors here
      });

      if (response?.error) {
        console.error("Google Sign in failed:", response.error);
        // *** Check for AccountPending error ***
        if (response.error === "AccountPending") {
          showPendingApprovalAlert();
          // *** End Check ***
        } else if (response.error === "AccountRejected") {
          setError("Your account has been rejected.");
          Swal.fire({
            icon: "error",
            title: "Account Rejected",
            text: "Your account access has been rejected.",
          });
        } else if (response.error === "OAuthAccountNotLinked") {
          setError(
            "This email is already associated with an account created using a different method. Try logging in with your original method."
          );
          Swal.fire({
            icon: "warning",
            title: "Account Exists",
            text: "This email is already associated with an account created using a different method (e.g., email/password). Please log in using that method.",
          });
        } else {
          setError("Google Sign-In failed. Please try again.");
          Swal.fire({
            icon: "error",
            title: "Google Sign-In Failed",
            text: "Could not sign in with Google. Please try again.",
          });
        }
        setIsGoogleLoading(false); // Stop loading on error
      } else if (response?.ok && response.url) {
        // If redirect: false and sign-in is OK, manually navigate
        console.log(
          "Google Sign in successful (redirect:false), redirecting..."
        );
        router.push(response.url);
        // No need to set loading false here
      } else if (!response?.ok && !response?.error) {
        // Handle cases where the sign-in might have been cancelled or closed by the user
        // Often, no explicit error is returned, just response.ok is false/null
        console.log("Google Sign in cancelled or closed by user.");
        setIsGoogleLoading(false); // Stop loading
      }
      // If redirect: true (default), successful Google sign-in will navigate away automatically.
    } catch (err) {
      console.error("Exception during Google sign in:", err);
      setError("An exception occurred during Google Sign-In.");
      Swal.fire({
        icon: "error",
        title: "Error",
        text: "An exception occurred during Google Sign-In.",
      });
      setIsGoogleLoading(false);
    }
  };

  return (
    <StartupHeader>
      <div
        className={`relative flex flex-grow items-center ${
          showSignInForm ? "justify-start" : "justify-center"
        } w-full overflow-hidden px-4 sm:px-8 py-8 md:py-16`}
      >
        {/* Landing Page Content (when showSignInForm is false) */}
        {!showSignInForm ? (
          <div className="relative flex flex-col md:flex-row items-center justify-between w-full max-w-7xl z-10">
            <div className="max-w-lg text-center md:text-left mb-10 md:mb-0 md:mr-10">
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-800 leading-tight">
                Stay ahead of potential threats with{" "}
                <span className="inline-block align-middle relative -translate-y-1">
                  <img
                    src="/aretex.png"
                    alt="Aretex Logo"
                    className="h-7 lg:h-9 inline-block align-middle mb-3"
                  />
                </span>{" "}
                <span className="text-red-500">Risk</span>{" "}
                <span className="text-gray-800">Radar</span>
              </h1>
              <p className="mt-4 text-gray-600">
                Making Aretex family safe by Predicting and Mapping High-Risk
                Areas Using Spatiotemporal Data Trends
              </p>
              <Button
                variant="primary"
                className="mt-6 px-6 py-3 font-semibold rounded-lg shadow-md"
                onClick={() => setShowSignInForm(true)}
                disabled={isLoading || isGoogleLoading}
              >
                Get Started
              </Button>
            </div>
          </div>
        ) : (
          // Updated Sign In Form to match the image
          <div className="z-10 max-w-md w-full bg-white rounded-lg p-8 shadow-sm">
            <h1 className="text-3xl font-bold text-gray-800 mb-2 text-center">
              Hi there!
            </h1>
            <p className="text-gray-600 text-base mb-8 text-center">
              Enter your credentials to access your account
            </p>

            {/* Google Sign In Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={isLoading || isGoogleLoading}
              className="w-full flex items-center justify-center px-4 py-2.5 bg-gray-100 text-gray-800 font-medium rounded-md hover:bg-gray-200 mb-6 border border-gray-200"
            >
              {isGoogleLoading ? (
                <span className="mr-2 animate-spin">⟳</span>
              ) : (
                <FcGoogle className="text-xl mr-2" />
              )}
              Sign in with Google
            </button>

            {/* OR Separator */}
            <div className="flex items-center w-full mb-6">
              <hr className="flex-grow border-gray-300" />
              <span className="px-4 text-gray-500 text-sm">or</span>
              <hr className="flex-grow border-gray-300" />
            </div>

            {/* Credentials Form */}
            <form onSubmit={handleSubmit} className="w-full text-black">
              <input
                type="email"
                name="email"
                placeholder="Email"
                className="w-full px-4 py-2.5 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400 placeholder-opacity-100"
                required
                disabled={isLoading || isGoogleLoading}
              />
              <input
                type="password"
                name="password"
                placeholder="Password"
                className="w-full px-4 py-2.5 mb-4 border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400 placeholder-opacity-100"
                required
                disabled={isLoading || isGoogleLoading}
              />

              {/* Remember me and Forgot password row */}
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="remember-me"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="mr-2"
                    disabled={isLoading || isGoogleLoading}
                  />
                  <label
                    htmlFor="remember-me"
                    className="text-sm text-gray-600"
                  >
                    Remember me
                  </label>
                </div>
                <Link
                  href="/forgot-password"
                  className="text-blue-600 text-sm hover:underline"
                  aria-disabled={isLoading || isGoogleLoading}
                  tabIndex={isLoading || isGoogleLoading ? -1 : undefined}
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                className={`w-full px-4 py-2.5 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 mb-4 ${
                  isLoading ? "opacity-70" : ""
                }`}
                disabled={isLoading || isGoogleLoading}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <span className="mr-2 animate-spin">⟳</span> Logging in...
                  </span>
                ) : (
                  "Log in"
                )}
              </button>
            </form>

            {/* General Error Display Area */}
            {error && (
              <p className="mt-4 text-center text-sm text-red-600 bg-red-100 p-2 rounded">
                {error}
              </p>
            )}

            {/* Sign Up Link */}
            <p className="mt-4 text-center text-sm text-gray-600">
              Don&apos;t have an account?{" "}
              <Link
                href="/registration"
                className="text-blue-600 hover:underline"
                aria-disabled={isLoading || isGoogleLoading}
                tabIndex={isLoading || isGoogleLoading ? -1 : undefined}
              >
                Sign up
              </Link>
            </p>

            {/* Back Button */}
            <button
              onClick={() => {
                if (!isLoading && !isGoogleLoading) {
                  setShowSignInForm(false);
                  setError(""); // Clear error when going back
                }
              }}
              className="mt-4 w-full px-4 py-2.5 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300"
              disabled={isLoading || isGoogleLoading}
            >
              Back
            </button>
          </div>
        )}
      </div>
    </StartupHeader>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInContent />
    </Suspense>
  );
}