import { NextResponse } from 'next/server'

const globalAny = globalThis as any
if (!globalAny.__overlayState) {
  globalAny.__overlayState = null
}

export async function GET() {
  return NextResponse.json({ state: globalAny.__overlayState })
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    globalAny.__overlayState = body
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false }, { status: 400 })
  }
}
