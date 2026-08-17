import { Building2, ChevronRight, CircuitBoard, Cpu, Network, Snowflake, Zap } from 'lucide-react'
import { memo } from 'react'

import type { Diagram, LineSystem, ProjectDocument } from '../domain/project'
import { Pressable, StatusTag } from './ui'

interface HierarchyPanelProps {
  document: ProjectDocument
  currentDiagramId: string
  onSelectDiagram: (diagramId: string) => void
}

const levelNames: Record<Diagram['level'], string> = {
  campus: '园区',
  building: '楼宇',
  pod: 'POD',
  device: '设备',
}

const levelIcons: Record<Diagram['level'], typeof Network> = {
  campus: Network,
  building: Building2,
  pod: CircuitBoard,
  device: Cpu,
}

function DiagramBranch({
  diagram,
  diagrams,
  depth,
  currentDiagramId,
  onSelectDiagram,
}: {
  diagram: Diagram
  diagrams: Diagram[]
  depth: number
  currentDiagramId: string
  onSelectDiagram: (diagramId: string) => void
}) {
  const children = diagrams.filter((candidate) => candidate.parentId === diagram.id)
  const Icon = levelIcons[diagram.level]
  return (
    <li role="treeitem" aria-current={diagram.id === currentDiagramId ? 'page' : undefined}>
      <Pressable
        className="tree-row"
        data-selected={diagram.id === currentDiagramId || undefined}
        style={{ paddingInlineStart: 12 + depth * 16 }}
        onClick={() => onSelectDiagram(diagram.id)}
      >
        <ChevronRight className="tree-row__branch" aria-hidden="true" />
        <Icon className="tree-row__icon" aria-hidden="true" />
        <span className="tree-row__name">{diagram.name}</span>
        <span className="tree-row__meta">{levelNames[diagram.level]}</span>
      </Pressable>
      {children.length ? (
        <ul role="group">
          {children.map((child) => (
            <DiagramBranch
              key={child.id}
              diagram={child}
              diagrams={diagrams}
              depth={depth + 1}
              currentDiagramId={currentDiagramId}
              onSelectDiagram={onSelectDiagram}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function LineBranch({
  lineSystem,
  document,
  currentDiagramId,
  onSelectDiagram,
}: {
  lineSystem: LineSystem
  document: ProjectDocument
  currentDiagramId: string
  onSelectDiagram: (diagramId: string) => void
}) {
  const root = document.diagrams.find((diagram) => diagram.id === lineSystem.rootDiagramId)
  const Icon = lineSystem.type === 'cooling' ? Snowflake : Zap
  return (
    <li className="tree-line" role="treeitem" aria-expanded="true">
      <div className="tree-line__heading">
        <Icon aria-hidden="true" />
        <span>{lineSystem.name}</span>
        <StatusTag tone={lineSystem.type === 'cooling' ? 'cooling' : 'electrical'}>
          {lineSystem.type === 'cooling' ? '冷却' : '电力'}
        </StatusTag>
      </div>
      {root ? (
        <ul role="group">
          <DiagramBranch
            diagram={root}
            diagrams={document.diagrams}
            depth={0}
            currentDiagramId={currentDiagramId}
            onSelectDiagram={onSelectDiagram}
          />
        </ul>
      ) : null}
    </li>
  )
}

export const HierarchyPanel = memo(function HierarchyPanel({
  document,
  currentDiagramId,
  onSelectDiagram,
}: HierarchyPanelProps) {
  return (
    <section className="sidebar-section hierarchy-section" aria-labelledby="hierarchy-title">
      <div className="panel-heading">
        <h2 id="hierarchy-title">图纸层级</h2>
        <span>{document.diagrams.length} 张</span>
      </div>
      <ul className="hierarchy-tree" role="tree" aria-label="冷却与电力图纸层级">
        {document.lineSystems.map((lineSystem) => (
          <LineBranch
            key={lineSystem.id}
            lineSystem={lineSystem}
            document={document}
            currentDiagramId={currentDiagramId}
            onSelectDiagram={onSelectDiagram}
          />
        ))}
      </ul>
    </section>
  )
}, (previous, next) => (
  previous.document.diagrams === next.document.diagrams &&
  previous.document.lineSystems === next.document.lineSystems &&
  previous.currentDiagramId === next.currentDiagramId &&
  previous.onSelectDiagram === next.onSelectDiagram
))
