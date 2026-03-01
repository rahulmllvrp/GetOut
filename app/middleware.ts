import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const start = Date.now();

  const response = NextResponse.next();

  // Calculate timing after the request is processed
  const duration = Date.now() - start;

  // Add timing header
  response.headers.set('x-response-time', `${duration}ms`);

  // Log to console with method, URL, and timing
  console.log(`${request.method} ${request.url} - ${duration}ms`);

  return response;
}

export const config = {
  matcher: '/api/:path*' // Only run on API routes
};