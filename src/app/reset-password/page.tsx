// c:/projects/Next-js/crimeatlas/src/app/reset-password/page.tsx
'use client';

import React, { useState, FormEvent, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Button from '@/app/components/Button'; // Assuming Button component exists
import Swal from 'sweetalert2';
import StartupHeader from '@/app/components/StartupHeader'; // Import StartupHeader

// Password Complexity Regex (Example - adjust as needed)
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const passwordRequirementsMessage = "Password must be 8+ characters with uppercase, lowercase, number, and special character (@$!%*?&).";

// Updated input style to match the provided UI
const inputFieldStyles = "w-full px-4 py-2 mb-4 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder-gray-500";
const errorTextStyles = "text-red-600 text-xs mt-1 text-left pl-4 -mt-3 mb-2"; // Style for error messages

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    const resetToken = searchParams.get('token');
    if (!resetToken) {
      Swal.fire('Invalid Link', 'The password reset link is missing or invalid.', 'error').then(() => {
        router.push('/'); // Redirect to home or login if token is missing
      });
    } else {
      setToken(resetToken);
    }
  }, [searchParams, router]);

  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {};
    let isValid = true;

    if (!password) errors.password = 'New password is required.';
    if (!confirmPassword) errors.confirmPassword = 'Password confirmation is required.';

    if (password && !passwordRegex.test(password)) {
        errors.password = passwordRequirementsMessage;
    }

    if (password && confirmPassword && password !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match.';
    }

    setValidationErrors(errors);
    isValid = Object.keys(errors).length === 0;
    return isValid;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationErrors({});

    if (!validateForm() || !token) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to reset password.');
      }

      Swal.fire('Success!', 'Your password has been reset successfully.', 'success').then(() => {
        router.push('/'); // Redirect to login page after success
      });

    } catch (error: any) {
      console.error('Reset Password Error:', error);
      Swal.fire('Error', error.message || 'An unexpected error occurred.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <StartupHeader>
      <main className="relative flex flex-col md:flex-row items-start justify-start w-full max-w-7xl px-8 py-16"> {/* Use px-8 from snippet */}
        <div className="z-10 bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center border border-gray-200">
          <h2 className="text-3xl font-bold text-gray-800 mb-2">
            Create new Password
          </h2>
          <p className="text-gray-600 mb-4 flex items-center justify-center">
            Create a secure password{" "}
            <img src="/password.png" alt="Password Icon" className="h-7 ml-2" /> {/* Ensure password.png is in public folder */}
          </p>
          <p className="text-gray-600 mb-6"> {/* Use original text size from snippet */}
            {passwordRequirementsMessage}
          </p>
          <form onSubmit={handleSubmit}>
            <input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${inputFieldStyles} ${validationErrors.password ? 'border-red-500' : ''}`} required disabled={isLoading} />
            {validationErrors.password && <p className={errorTextStyles}>{validationErrors.password}</p>}
            <input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={`${inputFieldStyles} ${validationErrors.confirmPassword ? 'border-red-500' : ''}`} required disabled={isLoading} />
            {validationErrors.confirmPassword && <p className={errorTextStyles}>{validationErrors.confirmPassword}</p>}
            <Button type="submit" variant="primary" className="w-full rounded-full" isLoading={isLoading} disabled={isLoading || !token}>
              {isLoading ? 'Resetting...' : 'Reset Password'}
            </Button> {/* Changed text from Back to Reset Password */}
          </form>
        </div>
      </main>
    </StartupHeader>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
