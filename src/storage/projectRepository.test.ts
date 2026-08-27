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

  it('mirrors monitor On/Off states into the saved project and removes them with it', async () => {
    const document = createDefaultProject('监控状态测试', [
      {
        key: 'switch',
        name: 'Switch',
        category: '电力',
        source: 'switch.svg',
        intrinsicWidth: 32,
        intrinsicHeight: 32,
        anchors: [],
      },
      {
        key: '2-wv',
        name: '2WV',
        category: '冷却',
        source: '2wv.svg',
        intrinsicWidth: 32,
        intrinsicHeight: 32,
        anchors: [],
      },
    ])
    document.elements = [
      {
        id: 'switch-1',
        diagramId: document.diagrams[0].id,
        assetKey: 'switch',
        name: 'Switch',
        x: 0,
        y: 0,
        width: 32,
        height: 32,
        rotation: 0,
        properties: { tag: 'SW-01' },
        extensions: {},
      },
      {
        id: '2-wv-1',
        diagramId: document.diagrams[0].id,
        assetKey: '2-wv',
        name: '2WV',
        x: 40,
        y: 0,
        width: 32,
        height: 32,
        rotation: 0,
        properties: { tag: '2WV-01' },
        extensions: {},
      },
    ]
    createdIds.push(document.project.id)
    await projectRepository.save(document)

    await monitorStateRepository.setOnOffState(document.project.id, 'switch-1', true)
    await monitorStateRepository.setOnOffState(document.project.id, '2-wv-1', false)

    expect(await monitorStateRepository.getOnOffStates(document.project.id)).toEqual({
      'switch-1': true,
      '2-wv-1': false,
    })
    expect((await projectRepository.get(document.project.id))?.elements).toMatchObject([
      { id: 'switch-1', onOffState: 'on' },
      { id: '2-wv-1', onOffState: 'off' },
    ])

    await projectRepository.delete(document.project.id)
    expect(await monitorStateRepository.getOnOffStates(document.project.id)).toEqual({})
  })
})
