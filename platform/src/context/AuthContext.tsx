import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase/config'
import { normalizeRoles } from '../lib/roles'
import type { UserProfile } from '../types'

interface AuthContextValue {
  firebaseUser: User | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function mapUserDoc(snap: { id: string; data: () => Record<string, unknown> }): UserProfile {
  const d = snap.data()
  return {
    id: snap.id,
    name: d.name as string,
    email: d.email as string,
    roles: normalizeRoles(d),
    status: d.status as UserProfile['status'],
    createdAt: d.createdAt,
    courseIds: (d.courseIds as string[]) ?? [],
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user)
      if (!user) {
        setProfile(null)
        setLoading(false)
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!firebaseUser) return
    const ref = doc(db, 'users', firebaseUser.uid)
    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setProfile(null)
        setLoading(false)
        return
      }
      setProfile(mapUserDoc(snap))
      setLoading(false)
    })
    return () => unsub()
  }, [firebaseUser])

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email.trim(), password)
  }, [])

  const logout = useCallback(async () => {
    await signOut(auth)
  }, [])

  const refreshProfile = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return
    const snap = await getDoc(doc(db, 'users', user.uid))
    if (!snap.exists()) return
    setProfile(mapUserDoc(snap))
  }, [])

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      loading,
      signIn,
      logout,
      refreshProfile,
    }),
    [
      firebaseUser,
      profile,
      loading,
      signIn,
      logout,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
