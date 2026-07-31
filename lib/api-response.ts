import { NextResponse } from "next/server";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Standard JSON error body used by most API routes. */
export function jsonError(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: errorMessage(error) }, { status });
}

export function jsonMessage(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}
