import Dexie, { type EntityTable } from 'dexie'

import {
  elementUsesOnOffState,
  type ProjectDocument,
} from '../domain/project'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

interface StoredProject extends ProjectSummary {
  document: ProjectDocument
}

export interface MonitorOnOffState {
  projectId: string
  elementId: string
  on: boolean
  updatedAt: string
}

interface StoredMonitorOnOffState extends MonitorOnOffState {
  key: string
}

interface ProjectDatabase extends Dexie {
  projects: EntityTable<StoredProject, 'id'>
  monitorSwitchStates: EntityTable<StoredMonitorOnOffState, 'key'>
}

const database = new Dexie('aidc-single-line-diagram') as ProjectDatabase
database.version(1).stores({
  projects: 'id, name, updatedAt',
})
database.version(2).stores({
  projects: 'id, name, updatedAt',
  monitorSwitchStates: 'key, projectId, elementId, updatedAt',
})

export interface ProjectRepository {
  save(document: ProjectDocument): Promise<void>
  get(id: string): Promise<ProjectDocument | undefined>
  list(): Promise<ProjectSummary[]>
  delete(id: string): Promise<void>
}

export const projectRepository: ProjectRepository = {
  async save(document) {
    await database.projects.put({
      id: document.project.id,
      name: document.project.name,
      updatedAt: document.project.updatedAt,
      document: structuredClone(document),
    })
  },

  async get(id) {
    const record = await database.projects.get(id)
    return record ? structuredClone(record.document) : undefined
  },

  async list() {
    const records = await database.projects.orderBy('updatedAt').reverse().toArray()
    return records.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
  },

  async delete(id) {
    await database.transaction('rw', database.projects, database.monitorSwitchStates, async () => {
      await database.projects.delete(id)
      await database.monitorSwitchStates.where('projectId').equals(id).delete()
    })
  },
}

export interface MonitorStateRepository {
  getOnOffStates(projectId: string): Promise<Record<string, boolean>>
  setOnOffState(projectId: string, elementId: string, on: boolean): Promise<void>
}

export const monitorStateRepository: MonitorStateRepository = {
  async getOnOffStates(projectId) {
    const records = await database.monitorSwitchStates
      .where('projectId')
      .equals(projectId)
      .toArray()
    return Object.fromEntries(records.map((record) => [record.elementId, record.on]))
  },

  async setOnOffState(projectId, elementId, on) {
    await database.transaction('rw', database.projects, database.monitorSwitchStates, async () => {
      await database.monitorSwitchStates.put({
        key: `${projectId}:${elementId}`,
        projectId,
        elementId,
        on,
        updatedAt: new Date().toISOString(),
      })
      const stored = await database.projects.get(projectId)
      if (!stored) return
      const elements = stored.document.elements.map((element) => (
        element.id === elementId && elementUsesOnOffState(element)
          ? { ...element, onOffState: on ? 'on' as const : 'off' as const }
          : element
      ))
      if (elements.every((element, index) => element === stored.document.elements[index])) return
      await database.projects.put({
        ...stored,
        document: { ...stored.document, elements },
      })
    })
  },
}
