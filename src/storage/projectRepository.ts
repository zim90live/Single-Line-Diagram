import Dexie, { type EntityTable } from 'dexie'

import type { ProjectDocument } from '../domain/project'

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
}

interface StoredProject extends ProjectSummary {
  document: ProjectDocument
}

interface ProjectDatabase extends Dexie {
  projects: EntityTable<StoredProject, 'id'>
}

const database = new Dexie('aidc-single-line-diagram') as ProjectDatabase
database.version(1).stores({
  projects: 'id, name, updatedAt',
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
    await database.projects.delete(id)
  },
}
