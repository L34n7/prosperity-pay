import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "prosperity-pay",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
