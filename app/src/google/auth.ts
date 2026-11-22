import { SocialLogin } from '@capgo/capacitor-social-login'
import { GOOGLE_SCOPES, WEB_CLIENT_ID, isGoogleConfigured } from '../constants'
import { storage } from '../storage'
import type { UserProfile } from '../types'

let initialized = false
let memoryToken: { token: string; expiresAt: number } | null = null

export function googleConfigError(): string | null {
  if (!isGoogleConfigured()) {
    return '尚未設定 Google 登入（缺少 Web 用戶端 ID）。請先在 Google Cloud 建立 OAuth 用戶端，把 Web 用戶端 ID 設成 GitHub repo variable GOOGLE_WEB_CLIENT_ID，再重新建置 APK。詳細步驟見 docs/android-apk.md。'
  }
  return null
}

export async function initGoogleAuth(): Promise<void> {
  if (initialized || !isGoogleConfigured()) return
  await SocialLogin.initialize({
    google: {
      webClientId: WEB_CLIENT_ID,
      mode: 'online',
    },
  })
  initialized = true
}

function rememberToken(token: string | undefined | null, expires?: string | null): void {
  if (!token) {
    memoryToken = null
    return
  }
  let expiresAt = Date.now() + 50 * 60 * 1000
  if (expires) {
    const parsed = Date.parse(expires)
    if (!Number.isNaN(parsed)) expiresAt = parsed - 60 * 1000
  }
  memoryToken = { token, expiresAt }
}

export async function signInWithGoogle(): Promise<UserProfile> {
  const err = googleConfigError()
  if (err) throw new Error(err)
  await initGoogleAuth()
  const res = await SocialLogin.login({
    provider: 'google',
    options: {
      scopes: GOOGLE_SCOPES,
      forceRefreshToken: true,
      style: 'standard',
    },
  })
  if (res.result.responseType !== 'online') {
    throw new Error('Google 登入沒有回傳可用的權杖，請再試一次。')
  }
  rememberToken(res.result.accessToken?.token, res.result.accessToken?.expires ?? null)
  const profile: UserProfile = {
    email: res.result.profile.email ?? '',
    name: res.result.profile.name ?? '',
    imageUrl: res.result.profile.imageUrl ?? '',
  }
  await storage.setProfile(profile.email, profile.name, profile.imageUrl)
  if (!memoryToken?.token) {
    await refreshAccessToken(true)
  }
  return profile
}

export async function refreshAccessToken(force = false): Promise<string> {
  await initGoogleAuth()
  if (!force && memoryToken && memoryToken.expiresAt > Date.now()) {
    return memoryToken.token
  }
  try {
    await SocialLogin.refresh({ provider: 'google', options: {} })
  } catch {
    // refresh may early-return or fail; try reading the current token next
  }
  const code = await SocialLogin.getAuthorizationCode({ provider: 'google' })
  if (!code.accessToken) {
    throw new Error('無法取得 Google 權杖，請重新登入。')
  }
  rememberToken(code.accessToken, null)
  return code.accessToken
}

export async function getAccessToken(): Promise<string> {
  return refreshAccessToken(false)
}

export async function isGoogleSignedIn(): Promise<boolean> {
  if (!isGoogleConfigured()) return false
  try {
    await initGoogleAuth()
    const { isLoggedIn } = await SocialLogin.isLoggedIn({ provider: 'google' })
    return isLoggedIn
  } catch {
    return false
  }
}

export async function signOutGoogle(): Promise<void> {
  memoryToken = null
  try {
    if (initialized) {
      await SocialLogin.logout({ provider: 'google' })
    }
  } catch {
    // ignore
  }
  await storage.clearAuth()
}
