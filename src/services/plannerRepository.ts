import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import { createSeedProject } from '../config/seedProject'
import { cloneJson } from '../lib/geometry'
import {
  LEGACY_PROJECT_ID,
  autoSaveName,
  defaultFloorHeight,
  createProjectStateFromSeed,
  normalizeUsername,
  parseTimestamp,
  pseudoEmailForUsername,
  slugify,
  toProjectState,
  toSaveRecord,
  withProjectMeta,
} from '../lib/plannerModel'
import {
  createSecondaryAuthServices,
  getFirebaseServices,
  isFirebaseConfigured,
} from './firebase'
import {
  createEmptyExteriorAssignments,
  type ExteriorTemplate,
  type ExportRecord,
  type Floor,
  type LayerType,
  type PlanEntity,
  type Project,
  type ProjectMember,
  type ProjectMembership,
  type ProjectMeta,
  type ProjectSaveRecord,
  type ProjectSaveSummary,
  type ProjectState,
  type Template,
  type UserProfile,
  type UserRole,
} from '../types/planner'

const legacyLocalStorageKey = 'blueprint-planner:project'

export interface ProjectRealtimeState {
  exists: boolean
  hasPendingWrites: boolean
  live: boolean
}

interface EntityContainer {
  entities?: PlanEntity[]
  entitiesById?: Record<string, PlanEntity>
  entityOrder?: string[]
}

interface RemoteTemplate extends Omit<Template, 'entities'>, EntityContainer {}

interface RemoteExteriorTemplate extends Omit<ExteriorTemplate, 'entities'>, EntityContainer {}

function normalizeUserProfile(data: UserProfile): UserProfile {
  return {
    ...data,
    blocked: data.blocked ?? false,
  }
}

function localCacheKey(userId: string, projectId: string, saveId: string) {
  return `blueprint-planner:${userId}:${projectId}:${saveId}`
}

function getLocalProjectState(userId: string | undefined, projectId: string, saveId: string): Project | null {
  if (!userId) {
    return null
  }

  const rawValue = window.localStorage.getItem(localCacheKey(userId, projectId, saveId))
  if (!rawValue) {
    return null
  }

  try {
    return JSON.parse(rawValue) as Project
  } catch {
    window.localStorage.removeItem(localCacheKey(userId, projectId, saveId))
    return null
  }
}

function saveLocalProjectState(userId: string | undefined, project: Project, saveId: string) {
  if (!userId) {
    return
  }

  window.localStorage.setItem(
    localCacheKey(userId, project.id, saveId),
    JSON.stringify(project),
  )
}

export function cacheProjectStateLocally(
  project: Project,
  options: {
    saveId: string
    userId?: string
  },
) {
  saveLocalProjectState(options.userId, cloneJson(project), options.saveId)
}

function removeLegacyLocalCache() {
  window.localStorage.removeItem(legacyLocalStorageKey)
}

function normalizeEntityStyle(entity: PlanEntity): PlanEntity {
  const maxStrokeWidth =
    entity.geometryType === 'point'
      ? 0.22
      : entity.geometryType === 'polyline'
        ? 0.28
        : entity.layerType === 'perimeter'
          ? 0.28
          : 0.38

  return {
    ...entity,
    style: {
      ...entity.style,
      strokeWidth: Math.min(entity.style.strokeWidth ?? maxStrokeWidth, maxStrokeWidth),
    },
  }
}

function mapTemplateEntities(template: EntityContainer): PlanEntity[] {
  if (template.entitiesById) {
    const entityMap = Object.fromEntries(
      Object.entries(template.entitiesById).map(([entityId, entity]) => [
        entityId,
        normalizeEntityStyle({
          ...entity,
          id: entity.id ?? entityId,
        }),
      ]),
    )

    const orderedIds = template.entityOrder?.filter((entityId) => entityMap[entityId]) ?? []
    const unorderedIds = Object.keys(entityMap).filter((entityId) => !orderedIds.includes(entityId))

    return [...orderedIds, ...unorderedIds].map((entityId) => entityMap[entityId])
  }

  return (template.entities ?? []).map((entity) => normalizeEntityStyle(entity))
}

function normalizedLegacyProjectName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return createSeedProject().name
  }

  return value === 'Eklavya Blueprint Lab' ? createSeedProject().name : value
}

function serializeTemplate(template: Template): RemoteTemplate {
  return {
    id: template.id,
    name: template.name,
    layerType: template.layerType,
    version: template.version,
    status: template.status,
    updatedAt: template.updatedAt,
    entityOrder: template.entities.map((entity) => entity.id),
    entitiesById: Object.fromEntries(template.entities.map((entity) => [entity.id, entity])),
  }
}

function serializeExteriorTemplate(template: ExteriorTemplate): RemoteExteriorTemplate {
  return {
    id: template.id,
    name: template.name,
    side: template.side,
    heightMeters: template.heightMeters,
    version: template.version,
    status: template.status,
    updatedAt: template.updatedAt,
    entityOrder: template.entities.map((entity) => entity.id),
    entitiesById: Object.fromEntries(template.entities.map((entity) => [entity.id, entity])),
  }
}

function normalizeProjectState(state: ProjectState): ProjectState {
  const seed = createProjectStateFromSeed()
  const schemaVersion = state.schemaVersion ?? seed.schemaVersion

  return {
    ...seed,
    ...state,
    schemaVersion,
    gridUnit: state.gridUnit ?? seed.gridUnit,
    floors: seed.floors.map((seedFloor) => {
      const floor =
        (state.floors ?? []).find((item) => item.id === seedFloor.id) ??
        (state.floors ?? []).find((item) => item.index === seedFloor.index) ??
        seedFloor

      return {
        ...seedFloor,
        ...floor,
        heightMeters: floor.heightMeters ?? defaultFloorHeight(floor.floorType ?? seedFloor.floorType),
        templateAssignments: {
          ...seedFloor.templateAssignments,
          ...floor.templateAssignments,
        },
        exterior: {
          ...createEmptyExteriorAssignments(),
          ...(floor.exterior ?? {}),
        },
      }
    }),
    templates: (state.templates ?? seed.templates).map((template) => ({
      ...template,
      entities: mapTemplateEntities(template as RemoteTemplate),
    })),
    exteriorTemplates: (state.exteriorTemplates ?? []).map((template) => ({
      ...template,
      entities: mapTemplateEntities(template as RemoteExteriorTemplate),
    })),
  }
}

function toProjectFromSave(
  meta: ProjectMeta,
  save: ProjectSaveRecord,
  floors: Floor[],
  templates: Template[],
  exteriorTemplates: ExteriorTemplate[],
): Project {
  return withProjectMeta(meta, normalizeProjectState({
    schemaVersion: save.schemaVersion,
    units: save.units,
    gridUnit: save.gridUnit,
    gridSpacing: save.gridSpacing,
    plotBoundary: save.plotBoundary,
    buildingBoundary: save.buildingBoundary,
    fixedStructures: save.fixedStructures,
    floors,
    templates,
    exteriorTemplates,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
  }))
}

async function loadProjectMetaDoc(projectId: string): Promise<ProjectMeta | null> {
  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const snapshot = await getDoc(doc(services.db, 'projects', projectId))
  if (!snapshot.exists()) {
    return null
  }

  const data = snapshot.data() as DocumentData
  if (typeof data.defaultSaveId !== 'string') {
    return null
  }

  return data as ProjectMeta
}

async function loadLegacyProject(projectId: string): Promise<Project | null> {
  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const projectDoc = await getDoc(doc(services.db, 'projects', projectId))
  if (!projectDoc.exists()) {
    return null
  }

  const data = projectDoc.data() as DocumentData
  if (typeof data.schemaVersion !== 'number') {
    return null
  }

  const [floorsSnapshot, templatesSnapshot] = await Promise.all([
    getDocs(collection(services.db, 'projects', projectId, 'floors')),
    getDocs(collection(services.db, 'projects', projectId, 'templates')),
  ])

  return normalizeProjectState({
    ...(data as Project),
    floors: floorsSnapshot.docs.map((item) => item.data()) as Floor[],
    templates: templatesSnapshot.docs.map((item) => item.data()) as Template[],
    exteriorTemplates: [],
  }) as Project
}

async function writeProjectState(
  batch: ReturnType<typeof writeBatch>,
  projectId: string,
  saveId: string,
  state: ProjectState,
  saveOptions: Pick<ProjectSaveRecord, 'id' | 'name' | 'archived' | 'isDefault' | 'parentSaveId' | 'sourceProjectId' | 'createdBy'>,
) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  batch.set(
    doc(services.db, 'projects', projectId, 'saves', saveId),
    toSaveRecord(saveOptions, state),
  )

  state.floors.forEach((floor) => {
    batch.set(doc(services.db, 'projects', projectId, 'saves', saveId, 'floors', floor.id), floor)
  })

  state.templates.forEach((template) => {
    batch.set(doc(services.db, 'projects', projectId, 'saves', saveId, 'templates', template.id), serializeTemplate(template))
  })

  state.exteriorTemplates.forEach((template) => {
    batch.set(
      doc(services.db, 'projects', projectId, 'saves', saveId, 'exteriorTemplates', template.id),
      serializeExteriorTemplate(template),
    )
  })
}

async function loadUserProfileDoc(uid: string): Promise<UserProfile | null> {
  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const snapshot = await getDoc(doc(services.db, 'users', uid))
  if (!snapshot.exists()) {
    return null
  }

  return normalizeUserProfile(snapshot.data() as UserProfile)
}

async function loadUserProfileByUsername(username: string): Promise<UserProfile | null> {
  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const normalizedUsername = normalizeUsername(username)
  const usernameSnapshot = await getDoc(doc(services.db, 'usernames', normalizedUsername))
  if (!usernameSnapshot.exists()) {
    return null
  }

  const usernameData = usernameSnapshot.data() as { uid?: string }
  if (typeof usernameData.uid !== 'string') {
    return null
  }

  return loadUserProfileDoc(usernameData.uid)
}

async function ensureProjectMemberDocs(projectId: string, profile: UserProfile, canEdit: boolean, archived: boolean, projectName: string) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const timestamp = new Date().toISOString()
  await Promise.all([
    setDoc(
      doc(services.db, 'projects', projectId, 'members', profile.uid),
      {
        uid: profile.uid,
        username: profile.username,
        canEdit,
        addedAt: timestamp,
        updatedAt: timestamp,
      } satisfies ProjectMember,
      { merge: true },
    ),
    setDoc(
      doc(services.db, 'users', profile.uid, 'projects', projectId),
      {
        projectId,
        projectName,
        canEdit,
        archived,
        addedAt: timestamp,
        updatedAt: timestamp,
      } satisfies ProjectMembership,
      { merge: true },
    ),
  ])
}

async function ensureSeedProjectMemberships(projectId: string, ownerProfile: UserProfile, projectName: string) {
  const memberSpecs = [
    { username: ownerProfile.username, canEdit: true },
    { username: 'aditya', canEdit: true },
    { username: 'anil', canEdit: false },
  ]

  const seenUids = new Set<string>()
  for (const spec of memberSpecs) {
    const profile =
      normalizeUsername(spec.username) === ownerProfile.normalizedUsername
        ? ownerProfile
        : await loadUserProfileByUsername(spec.username)

    if (!profile || seenUids.has(profile.uid)) {
      continue
    }

    seenUids.add(profile.uid)
    await ensureProjectMemberDocs(projectId, profile, spec.canEdit, false, projectName)
  }
}

export function subscribeToAuthState(handler: (user: User | null) => void): Unsubscribe {
  const services = getFirebaseServices()
  if (!services) {
    handler(null)
    return () => undefined
  }

  return onAuthStateChanged(services.auth, handler)
}

export function subscribeToUserProfile(
  uid: string,
  handlers: {
    onProfile: (profile: UserProfile | null) => void
    onError?: (error: Error) => void
  },
): Unsubscribe {
  const services = getFirebaseServices()
  if (!services) {
    handlers.onProfile(null)
    return () => undefined
  }

  return onSnapshot(
    doc(services.db, 'users', uid),
    (snapshot) => {
      if (!snapshot.exists()) {
        handlers.onProfile(null)
        return
      }

      handlers.onProfile(normalizeUserProfile(snapshot.data() as UserProfile))
    },
    (error) => {
      handlers.onError?.(error)
    },
  )
}

export async function signIn(username: string, password: string) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const normalizedUsername = normalizeUsername(username)
  const credential = await signInWithEmailAndPassword(
    services.auth,
    pseudoEmailForUsername(normalizedUsername),
    password,
  )

  const profile = await loadUserProfileDoc(credential.user.uid)
  if (!profile) {
    throw new Error('User profile is missing for this account.')
  }

  return profile
}

export async function signOutUser() {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  await signOut(services.auth)
}

export async function loadCurrentUserProfile(uid: string) {
  return loadUserProfileDoc(uid)
}

export async function loadUserProfile(uid: string) {
  return loadUserProfileDoc(uid)
}

export async function createUser(options: {
  username: string
  password: string
  role: UserRole
}) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const normalizedUsername = normalizeUsername(options.username)
  const existingUsername = await getDoc(doc(services.db, 'usernames', normalizedUsername))
  if (existingUsername.exists()) {
    throw new Error('Username already exists.')
  }

  const secondary = await createSecondaryAuthServices(`planner-admin-${Date.now()}`)
  if (!secondary) {
    throw new Error('Firebase configuration is missing.')
  }

  const timestamp = new Date().toISOString()

  try {
    const credential = await createUserWithEmailAndPassword(
      secondary.auth,
      pseudoEmailForUsername(normalizedUsername),
      options.password,
    )

    const profile: UserProfile = {
      uid: credential.user.uid,
      username: options.username.trim(),
      normalizedUsername,
      role: options.role,
      archived: false,
      blocked: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    await Promise.all([
      setDoc(doc(services.db, 'users', profile.uid), profile),
      setDoc(doc(services.db, 'usernames', normalizedUsername), { uid: profile.uid }),
    ])

    await signOut(secondary.auth)
    await secondary.cleanup()
    return profile
  } catch (error) {
    await secondary.cleanup()
    throw error
  }
}

export async function updateUserRole(uid: string, role: UserRole) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const profile = await loadUserProfileDoc(uid)
  if (!profile) {
    throw new Error('User not found.')
  }

  await setDoc(
    doc(services.db, 'users', uid),
    {
      role,
      updatedAt: new Date().toISOString(),
    } satisfies Partial<UserProfile>,
    { merge: true },
  )
}

export async function setUserBlocked(uid: string, blocked: boolean, actorUid: string) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const profile = await loadUserProfileDoc(uid)
  if (!profile) {
    throw new Error('User not found.')
  }

  const timestamp = new Date().toISOString()
  await setDoc(
    doc(services.db, 'users', uid),
    {
      blocked,
      blockedAt: blocked ? timestamp : deleteField(),
      blockedBy: blocked ? actorUid : deleteField(),
      updatedAt: timestamp,
    },
    { merge: true },
  )
}

export async function ensureDefaultUsers() {
  if (!isFirebaseConfigured()) {
    return
  }

  const defaultUsers: Array<{ username: string; password: string; role: UserRole }> = [
    { username: 'aditya', password: 'greatest', role: 'admin' },
    { username: 'anil', password: 'greatest', role: 'user' },
  ]

  for (const user of defaultUsers) {
    try {
      await createUser(user)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'Username already exists.') {
        continue
      }

      throw error
    }
  }
}

export async function listUsers() {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const snapshot = await getDocs(query(collection(services.db, 'users')))
  return snapshot.docs
    .map((item) => normalizeUserProfile(item.data() as UserProfile))
    .sort((left, right) => left.username.localeCompare(right.username))
}

export async function loadUserMemberships(uid: string) {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const snapshot = await getDocs(collection(services.db, 'users', uid, 'projects'))
  return snapshot.docs
    .map((item) => item.data() as ProjectMembership)
    .sort((left, right) => left.projectName.localeCompare(right.projectName))
}

export async function loadAllProjectMetas() {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const snapshot = await getDocs(collection(services.db, 'projects'))
  return snapshot.docs
    .map((item) => item.data() as ProjectMeta)
    .filter((project) => typeof project.defaultSaveId === 'string')
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function loadProjectsForUser(uid: string, options?: { archived?: boolean }) {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const archived = options?.archived ?? false
  const membershipsSnapshot = await getDocs(collection(services.db, 'users', uid, 'projects'))
  const memberships = membershipsSnapshot.docs
    .map((item) => item.data() as ProjectMembership)
    .filter((membership) => membership.archived === archived)

  const metas = await Promise.all(
    memberships.map(async (membership) => {
      const meta = await loadProjectMetaDoc(membership.projectId)
      if (!meta) {
        return null
      }

      return {
        ...meta,
        canEdit: membership.canEdit,
      }
    }),
  )

  return metas
    .filter((item): item is ProjectMeta & { canEdit: boolean } => Boolean(item))
    .sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt))
}

export async function createProject(options: {
  name: string
  creatorUid: string
}) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const creator = await loadUserProfileDoc(options.creatorUid)
  if (!creator) {
    throw new Error('Unable to resolve creator profile.')
  }

  const timestamp = new Date().toISOString()
  const projectId = `${slugify(options.name)}-${Date.now()}`
  const defaultSaveId = 'save-default'
  const state = createProjectStateFromSeed()
  state.createdAt = timestamp
  state.updatedAt = timestamp

  const meta: ProjectMeta = {
    id: projectId,
    name: options.name.trim(),
    archived: false,
    createdBy: creator.uid,
    createdAt: timestamp,
    updatedAt: timestamp,
    defaultSaveId,
    lastOpenedSaveId: defaultSaveId,
    migrationVersion: 1,
  }

  const batch = writeBatch(services.db)
  batch.set(doc(services.db, 'projects', projectId), meta)
  await writeProjectState(batch, projectId, defaultSaveId, state, {
    id: defaultSaveId,
    name: 'Default Save',
    archived: false,
    isDefault: true,
    parentSaveId: null,
    sourceProjectId: null,
    createdBy: creator.uid,
  })
  await batch.commit()

  await ensureProjectMemberDocs(projectId, creator, true, false, meta.name)
  return {
    meta,
    saveId: defaultSaveId,
  }
}

export async function archiveProject(projectId: string, archived: boolean) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const meta = await loadProjectMetaDoc(projectId)
  if (!meta) {
    throw new Error('Project not found.')
  }

  const membersSnapshot = await getDocs(collection(services.db, 'projects', projectId, 'members'))
  const batch = writeBatch(services.db)
  batch.set(
    doc(services.db, 'projects', projectId),
    {
      archived,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )

  membersSnapshot.docs.forEach((item) => {
    const member = item.data() as ProjectMember
    batch.set(
      doc(services.db, 'users', member.uid, 'projects', projectId),
      {
        archived,
        projectName: meta.name,
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    )
  })

  await batch.commit()
}

export async function loadProjectMeta(projectId: string) {
  const meta = await loadProjectMetaDoc(projectId)
  if (meta) {
    return meta
  }

  const legacyProject = await loadLegacyProject(projectId)
  if (!legacyProject) {
    return null
  }

  return {
    id: legacyProject.id,
    name: normalizedLegacyProjectName(legacyProject.name),
    archived: false,
    createdBy: '',
    createdAt: legacyProject.createdAt,
    updatedAt: legacyProject.updatedAt,
    defaultSaveId: 'save-default',
    lastOpenedSaveId: 'save-default',
  } satisfies ProjectMeta
}

export async function setLastOpenedSave(projectId: string, saveId: string) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  await setDoc(
    doc(services.db, 'projects', projectId),
    {
      lastOpenedSaveId: saveId,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
}

export async function loadProjectMembers(projectId: string) {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const snapshot = await getDocs(collection(services.db, 'projects', projectId, 'members'))
  return snapshot.docs
    .map((item) => item.data() as ProjectMember)
    .sort((left, right) => left.username.localeCompare(right.username))
}

export async function updateProjectMembership(projectId: string, uid: string, options: { canEdit: boolean }) {
  const meta = await loadProjectMetaDoc(projectId)
  const profile = await loadUserProfileDoc(uid)
  if (!meta || !profile) {
    throw new Error('Unable to update membership.')
  }

  await ensureProjectMemberDocs(projectId, profile, options.canEdit, meta.archived, meta.name)
}

export async function linkUserToProject(uid: string, projectId: string, canEdit: boolean) {
  await updateProjectMembership(projectId, uid, { canEdit })
}

export async function removeProjectMembership(projectId: string, uid: string) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  await Promise.all([
    deleteDoc(doc(services.db, 'projects', projectId, 'members', uid)),
    deleteDoc(doc(services.db, 'users', uid, 'projects', projectId)),
  ])
}

export async function unlinkUserFromProject(uid: string, projectId: string) {
  await removeProjectMembership(projectId, uid)
}

export async function setUserProjectAccess(uid: string, projectId: string, canEdit: boolean) {
  await updateProjectMembership(projectId, uid, { canEdit })
}

export async function loadSaves(projectId: string, options?: { archived?: boolean }) {
  const services = getFirebaseServices()
  if (!services) {
    return []
  }

  const snapshot = await getDocs(collection(services.db, 'projects', projectId, 'saves'))
  const archived = options?.archived ?? false

  return snapshot.docs
    .map((item) => item.data() as ProjectSaveRecord)
    .filter((save) => save.archived === archived)
    .map((save) => ({
      id: save.id,
      name: save.name,
      archived: save.archived,
      isDefault: save.isDefault,
      parentSaveId: save.parentSaveId,
      sourceProjectId: save.sourceProjectId,
      createdBy: save.createdBy,
      createdAt: save.createdAt,
      updatedAt: save.updatedAt,
    } satisfies ProjectSaveSummary))
    .sort((left, right) => parseTimestamp(right.updatedAt) - parseTimestamp(left.updatedAt))
}

export async function loadSave(projectId: string, saveId: string, userId?: string): Promise<Project> {
  const localProject = getLocalProjectState(userId, projectId, saveId)
  const meta = await loadProjectMeta(projectId)

  if (!meta) {
    throw new Error('Project not found.')
  }

  const services = getFirebaseServices()
  if (!services) {
    if (localProject) {
      return localProject
    }
    throw new Error('Firebase configuration is missing.')
  }

  const saveSnapshot = await getDoc(doc(services.db, 'projects', projectId, 'saves', saveId))
  if (!saveSnapshot.exists()) {
    const legacyProject = await loadLegacyProject(projectId)
    if (legacyProject) {
      return legacyProject
    }
    throw new Error('Save not found.')
  }

  const [floorsSnapshot, templatesSnapshot, exteriorTemplatesSnapshot] = await Promise.all([
    getDocs(collection(services.db, 'projects', projectId, 'saves', saveId, 'floors')),
    getDocs(collection(services.db, 'projects', projectId, 'saves', saveId, 'templates')),
    getDocs(collection(services.db, 'projects', projectId, 'saves', saveId, 'exteriorTemplates')),
  ])

  const remoteProject = toProjectFromSave(
    meta,
    saveSnapshot.data() as ProjectSaveRecord,
    floorsSnapshot.docs.map((item) => item.data()) as Floor[],
    templatesSnapshot.docs.map((item) => item.data() as RemoteTemplate).map((item) => ({
      ...item,
      entities: mapTemplateEntities(item),
    })),
    exteriorTemplatesSnapshot.docs.map((item) => item.data() as RemoteExteriorTemplate).map((item) => ({
      ...item,
      entities: mapTemplateEntities(item),
    })),
  )

  if (!localProject) {
    saveLocalProjectState(userId, remoteProject, saveId)
    removeLegacyLocalCache()
    return remoteProject
  }

  if (parseTimestamp(remoteProject.updatedAt) >= parseTimestamp(localProject.updatedAt)) {
    saveLocalProjectState(userId, remoteProject, saveId)
    removeLegacyLocalCache()
    return remoteProject
  }

  return localProject
}

export function subscribeToSave(
  projectId: string,
  saveId: string,
  handlers: {
    onProject: (project: Project) => void
    onStateChange: (state: ProjectRealtimeState) => void
    onError: (error: Error) => void
  },
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    return () => undefined
  }

  const services = getFirebaseServices()
  if (!services) {
    return () => undefined
  }

  const projectRef = doc(services.db, 'projects', projectId)
  const saveRef = doc(services.db, 'projects', projectId, 'saves', saveId)
  const floorsRef = collection(services.db, 'projects', projectId, 'saves', saveId, 'floors')
  const templatesRef = collection(services.db, 'projects', projectId, 'saves', saveId, 'templates')
  const exteriorTemplatesRef = collection(services.db, 'projects', projectId, 'saves', saveId, 'exteriorTemplates')

  let projectSnapshot: Awaited<ReturnType<typeof getDoc>> | null = null
  let saveSnapshot: Awaited<ReturnType<typeof getDoc>> | null = null
  let floorsSnapshot: QuerySnapshot | null = null
  let templatesSnapshot: QuerySnapshot | null = null
  let exteriorTemplatesSnapshot: QuerySnapshot | null = null

  function emitState() {
    if (!projectSnapshot || !saveSnapshot || !floorsSnapshot || !templatesSnapshot || !exteriorTemplatesSnapshot) {
      return
    }

    const hasPendingWrites =
      projectSnapshot.metadata.hasPendingWrites ||
      saveSnapshot.metadata.hasPendingWrites ||
      floorsSnapshot.metadata.hasPendingWrites ||
      templatesSnapshot.metadata.hasPendingWrites ||
      exteriorTemplatesSnapshot.metadata.hasPendingWrites
    const live =
      !projectSnapshot.metadata.fromCache &&
      !saveSnapshot.metadata.fromCache &&
      !floorsSnapshot.metadata.fromCache &&
      !templatesSnapshot.metadata.fromCache &&
      !exteriorTemplatesSnapshot.metadata.fromCache

    handlers.onStateChange({
      exists: saveSnapshot.exists(),
      hasPendingWrites,
      live,
    })

    if (!projectSnapshot.exists() || !saveSnapshot.exists()) {
      return
    }

    handlers.onProject(
      toProjectFromSave(
        projectSnapshot.data() as ProjectMeta,
        saveSnapshot.data() as ProjectSaveRecord,
        floorsSnapshot.docs.map((item) => item.data()) as Floor[],
        templatesSnapshot.docs.map((item) => item.data() as RemoteTemplate).map((item) => ({
          ...item,
          entities: mapTemplateEntities(item),
        })),
        exteriorTemplatesSnapshot.docs.map((item) => item.data() as RemoteExteriorTemplate).map((item) => ({
          ...item,
          entities: mapTemplateEntities(item),
        })),
      ),
    )
  }

  const listenOptions = { includeMetadataChanges: true }
  const unsubscribers: Unsubscribe[] = [
    onSnapshot(projectRef, listenOptions, (snapshot) => {
      projectSnapshot = snapshot
      emitState()
    }, handlers.onError),
    onSnapshot(saveRef, listenOptions, (snapshot) => {
      saveSnapshot = snapshot
      emitState()
    }, handlers.onError),
    onSnapshot(floorsRef, listenOptions, (snapshot) => {
      floorsSnapshot = snapshot
      emitState()
    }, handlers.onError),
    onSnapshot(templatesRef, listenOptions, (snapshot) => {
      templatesSnapshot = snapshot
      emitState()
    }, handlers.onError),
    onSnapshot(exteriorTemplatesRef, listenOptions, (snapshot) => {
      exteriorTemplatesSnapshot = snapshot
      emitState()
    }, handlers.onError),
  ]

  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
  }
}

export async function createSaveFromSource(options: {
  projectId: string
  sourceSaveId: string
  name?: string
  creatorUid: string
}) {
  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const sourceProject = await loadSave(options.projectId, options.sourceSaveId, options.creatorUid)
  const saveId = `${slugify(options.name ?? autoSaveName())}-${Date.now()}`
  const saveName = options.name?.trim() || autoSaveName()
  const timestamp = new Date().toISOString()
  const state = toProjectState(sourceProject)
  state.updatedAt = timestamp

  const batch = writeBatch(services.db)
  await writeProjectState(batch, options.projectId, saveId, state, {
    id: saveId,
    name: saveName,
    archived: false,
    isDefault: false,
    parentSaveId: options.sourceSaveId,
    sourceProjectId: options.projectId,
    createdBy: options.creatorUid,
  })
  batch.set(
    doc(services.db, 'projects', options.projectId),
    {
      updatedAt: timestamp,
      lastOpenedSaveId: saveId,
    },
    { merge: true },
  )
  await batch.commit()

  return saveId
}

export async function archiveSave(projectId: string, saveId: string, archived: boolean) {
  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const saveSnapshot = await getDoc(doc(services.db, 'projects', projectId, 'saves', saveId))
  if (!saveSnapshot.exists()) {
    throw new Error('Save not found.')
  }

  const save = saveSnapshot.data() as ProjectSaveRecord
  if (save.isDefault && archived) {
    throw new Error('Default save cannot be archived.')
  }

  await setDoc(
    doc(services.db, 'projects', projectId, 'saves', saveId),
    {
      archived,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  )
}

export async function cloneProject(options: {
  sourceProjectId: string
  sourceSaveId: string
  newProjectName: string
  creatorUid: string
}) {
  const cloned = await createProject({
    name: options.newProjectName,
    creatorUid: options.creatorUid,
  })

  const services = getFirebaseServices()
  if (!services) {
    throw new Error('Firebase configuration is missing.')
  }

  const sourceProject = await loadSave(options.sourceProjectId, options.sourceSaveId, options.creatorUid)
  const timestamp = new Date().toISOString()
  const state = toProjectState(sourceProject)
  state.createdAt = timestamp
  state.updatedAt = timestamp

  const batch = writeBatch(services.db)
  await writeProjectState(batch, cloned.meta.id, cloned.saveId, state, {
    id: cloned.saveId,
    name: 'Default Save',
    archived: false,
    isDefault: true,
    parentSaveId: null,
    sourceProjectId: options.sourceProjectId,
    createdBy: options.creatorUid,
  })
  batch.set(
    doc(services.db, 'projects', cloned.meta.id),
    {
      updatedAt: timestamp,
      lastOpenedSaveId: cloned.saveId,
    },
    { merge: true },
  )
  await batch.commit()

  return cloned
}

export async function saveActiveProjectState(
  _previousProject: Project | null,
  project: Project,
  options: {
    projectId: string
    saveId: string
    userId?: string
  },
): Promise<void> {
  const snapshot = cloneJson(project)
  saveLocalProjectState(options.userId, snapshot, options.saveId)

  const services = getFirebaseServices()
  if (!services) {
    return
  }

  const saveRef = doc(services.db, 'projects', options.projectId, 'saves', options.saveId)
  const floorsCollectionRef = collection(services.db, 'projects', options.projectId, 'saves', options.saveId, 'floors')
  const templatesCollectionRef = collection(services.db, 'projects', options.projectId, 'saves', options.saveId, 'templates')
  const exteriorTemplatesCollectionRef = collection(
    services.db,
    'projects',
    options.projectId,
    'saves',
    options.saveId,
    'exteriorTemplates',
  )
  const [saveSnapshot, floorsSnapshot, templatesSnapshot, exteriorTemplatesSnapshot] = await Promise.all([
    getDoc(saveRef),
    getDocs(floorsCollectionRef),
    getDocs(templatesCollectionRef),
    getDocs(exteriorTemplatesCollectionRef),
  ])

  const currentSave = saveSnapshot.exists()
    ? (saveSnapshot.data() as ProjectSaveRecord)
    : ({
        id: options.saveId,
        name: options.saveId === 'save-default' ? 'Default Save' : options.saveId,
        archived: false,
        isDefault: options.saveId === 'save-default',
        parentSaveId: null,
        sourceProjectId: null,
        createdBy: options.userId ?? '',
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        schemaVersion: snapshot.schemaVersion,
        units: snapshot.units,
        gridUnit: snapshot.gridUnit,
        gridSpacing: snapshot.gridSpacing,
        plotBoundary: snapshot.plotBoundary,
        buildingBoundary: snapshot.buildingBoundary,
        fixedStructures: snapshot.fixedStructures,
      } satisfies ProjectSaveRecord)

  const batch = writeBatch(services.db)
  await writeProjectState(batch, options.projectId, options.saveId, toProjectState(snapshot), {
    id: currentSave.id,
    name: currentSave.name,
    archived: currentSave.archived,
    isDefault: currentSave.isDefault,
    parentSaveId: currentSave.parentSaveId,
    sourceProjectId: currentSave.sourceProjectId,
    createdBy: currentSave.createdBy,
  })

  const nextFloorIds = new Set(snapshot.floors.map((floor) => floor.id))
  floorsSnapshot.docs.forEach((floorDoc) => {
    if (!nextFloorIds.has(floorDoc.id)) {
      batch.delete(doc(services.db, 'projects', options.projectId, 'saves', options.saveId, 'floors', floorDoc.id))
    }
  })

  const nextTemplateIds = new Set(snapshot.templates.map((template) => template.id))
  templatesSnapshot.docs.forEach((templateDoc) => {
    if (!nextTemplateIds.has(templateDoc.id)) {
      batch.delete(doc(services.db, 'projects', options.projectId, 'saves', options.saveId, 'templates', templateDoc.id))
    }
  })

  const nextExteriorTemplateIds = new Set(snapshot.exteriorTemplates.map((template) => template.id))
  exteriorTemplatesSnapshot.docs.forEach((templateDoc) => {
    if (!nextExteriorTemplateIds.has(templateDoc.id)) {
      batch.delete(
        doc(services.db, 'projects', options.projectId, 'saves', options.saveId, 'exteriorTemplates', templateDoc.id),
      )
    }
  })

  batch.set(
    doc(services.db, 'projects', options.projectId),
    {
      updatedAt: snapshot.updatedAt,
      lastOpenedSaveId: options.saveId,
    },
    { merge: true },
  )

  await batch.commit()
}

export async function uploadExport(
  project: Project,
  floorId: string,
  visibleLayers: LayerType[],
  saveId: string,
): Promise<ExportRecord> {
  const floor = project.floors.find((item) => item.id === floorId)
  if (!floor) {
    throw new Error('Unable to find floor for export.')
  }

  const exportRecord: ExportRecord = {
    id: `export-${Date.now()}`,
    floorId,
    floorName: floor.name,
    storagePath: '',
    visibleLayers,
    createdAt: new Date().toISOString(),
  }

  const services = getFirebaseServices()
  if (!services) {
    return exportRecord
  }

  await setDoc(
    doc(services.db, 'projects', project.id, 'saves', saveId, 'exports', exportRecord.id),
    exportRecord,
  )

  return exportRecord
}

export async function migrateLegacyProjectForAdmin(uid: string) {
  const services = getFirebaseServices()
  if (!services) {
    return null
  }

  const profile = await loadUserProfileDoc(uid)
  if (!profile) {
    throw new Error('Admin profile not found.')
  }

  const legacyRoot = await getDoc(doc(services.db, 'projects', LEGACY_PROJECT_ID))
  if (!legacyRoot.exists()) {
    const seedProject = createSeedProject()
    const meta: ProjectMeta = {
      id: LEGACY_PROJECT_ID,
      name: seedProject.name,
      archived: false,
      createdBy: profile.uid,
      createdAt: seedProject.createdAt,
      updatedAt: seedProject.updatedAt,
      defaultSaveId: 'save-default',
      lastOpenedSaveId: 'save-default',
      migrationVersion: 1,
    }

    const batch = writeBatch(services.db)
    batch.set(doc(services.db, 'projects', LEGACY_PROJECT_ID), meta)
    await writeProjectState(batch, LEGACY_PROJECT_ID, 'save-default', toProjectState(seedProject), {
      id: 'save-default',
      name: 'Default Save',
      archived: false,
      isDefault: true,
      parentSaveId: null,
      sourceProjectId: null,
      createdBy: profile.uid,
    })
    await batch.commit()

    await ensureSeedProjectMemberships(LEGACY_PROJECT_ID, profile, meta.name)
    return meta
  }

  const legacyData = legacyRoot.data() as DocumentData
  if (typeof legacyData.schemaVersion !== 'number') {
    return null
  }

  if (legacyData.migrationVersion === 1 && typeof legacyData.defaultSaveId === 'string') {
    await ensureSeedProjectMemberships(LEGACY_PROJECT_ID, profile, legacyData.name as string ?? createSeedProject().name)
    return legacyData as ProjectMeta
  }

  const [floorsSnapshot, templatesSnapshot] = await Promise.all([
    getDocs(collection(services.db, 'projects', LEGACY_PROJECT_ID, 'floors')),
    getDocs(collection(services.db, 'projects', LEGACY_PROJECT_ID, 'templates')),
  ])

  const project = normalizeProjectState({
    ...(legacyData as Project),
    floors: floorsSnapshot.docs.map((item) => item.data()) as Floor[],
    templates: templatesSnapshot.docs.map((item) => item.data() as RemoteTemplate).map((item) => ({
      ...item,
      entities: mapTemplateEntities(item),
    })),
  })

  const timestamp = new Date().toISOString()
  const meta: ProjectMeta = {
    id: LEGACY_PROJECT_ID,
    name: normalizedLegacyProjectName(legacyData.name),
    archived: false,
    createdBy: uid,
    createdAt: legacyData.createdAt ?? timestamp,
    updatedAt: timestamp,
    defaultSaveId: 'save-default',
    lastOpenedSaveId: 'save-default',
    migrationVersion: 1,
  }

  const existingSave = await getDoc(doc(services.db, 'projects', LEGACY_PROJECT_ID, 'saves', 'save-default'))
  const batch = writeBatch(services.db)
  batch.set(doc(services.db, 'projects', LEGACY_PROJECT_ID), meta, { merge: true })
  if (!existingSave.exists()) {
    await writeProjectState(batch, LEGACY_PROJECT_ID, 'save-default', project, {
      id: 'save-default',
      name: 'Default Save',
      archived: false,
      isDefault: true,
      parentSaveId: null,
      sourceProjectId: null,
      createdBy: uid,
    })
  }
  await batch.commit()

  await ensureSeedProjectMemberships(LEGACY_PROJECT_ID, profile, meta.name)
  return meta
}
