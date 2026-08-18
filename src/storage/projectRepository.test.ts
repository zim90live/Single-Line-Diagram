import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultProject } from '../domain/project'
import { monitorStateRepository, projectRepository } from './projectRepository'

const createdIds: string[] = []

afterEach(async () => {
  await Promise.all(createdIds.splice(0).map((id) => projectRepository.delete(id)))
})

describe('project repository', () => {
  it('saves, lists, loads, and deletes a browser-local project', async () => {
    const document = createDefaultProject('本地存储测试', [{
      key: 'test-symbol',
      name: '测试图元',
      category: '测试',
      source: 'test.svg',
      intrinsicWidth: 64,
      intrinsicHeight: 64,
      anchors: [{
        id: 'anchor-1',
        name: '电路 1',
        x: 8,
        y: 0,
        direction: 'top',
        type: 'electrical',
      }],
    }])
    createdIds.push(document.project.id)

    await projectRepository.save(document)

    expect(await projectRepository.list()).toContainEqual({
      id: document.project.id,
      name: '本地存储测试',
      updatedAt: document.project.updatedAt,
    })
    expect(await projectRepository.get(document.project.id)).toEqual(document)

    await projectRepository.delete(document.project.id)
    expect(await projectRepository.get(document.project.id)).toBeUndefined()
  })

  it('stores monitor switch state separately and removes it with the project', async () => {
    const document = createDefaultProject('监控状态测试', [])
    createdIds.push(document.project.id)
    await projectRepository.save(document)

    await monitorStateRepository.setSwitchState(document.project.id, 'switch-1', true)
    await monitorStateRepository.setSwitchState(document.project.id, 'switch-2', false)

    expect(await monitorStateRepository.getSwitchStates(document.project.id)).toEqual({
      'switch-1': true,
      'switch-2': false,
    })
    expect(await projectRepository.get(document.project.id)).toEqual(document)

    await projectRepository.delete(document.project.id)
    expect(await monitorStateRepository.getSwitchStates(document.project.id)).toEqual({})
  })
})
