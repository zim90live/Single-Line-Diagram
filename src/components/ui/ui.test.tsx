import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Button, NumericField, Switch, Tab, TabList } from './index'

describe('shared UI primitives', () => {
  it('exposes loading and disabled state on Button', () => {
    render(<Button loading onClick={vi.fn()}>保存</Button>)
    const button = screen.getByRole('button', { name: '保存' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('exposes a mixed Switch and resolves it through the native change event', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Switch label="批量显示标签" checked={false} indeterminate onChange={onChange} />)
    const control = screen.getByRole('switch', { name: '批量显示标签' })
    expect(control).toHaveAttribute('aria-checked', 'mixed')
    expect((control as HTMLInputElement).indeterminate).toBe(true)
    await user.click(control)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('moves and activates tabs with arrow keys', async () => {
    const user = userEvent.setup()
    function Example() {
      const [active, setActive] = useState<'edit' | 'monitor'>('edit')
      return (
        <TabList label="工作模式">
          <Tab selected={active === 'edit'} onClick={() => setActive('edit')}>编辑</Tab>
          <Tab selected={active === 'monitor'} onClick={() => setActive('monitor')}>监控</Tab>
        </TabList>
      )
    }
    render(<Example />)
    const edit = screen.getByRole('tab', { name: '编辑' })
    edit.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '监控' })).toHaveAttribute('aria-selected', 'true')
  })

  it('commits a valid numeric draft on blur', async () => {
    const user = userEvent.setup()
    const onCommit = vi.fn()
    render(<NumericField label="X" value={8} min={0} max={100} step={8} onCommit={onCommit} />)
    const input = screen.getByRole('textbox', { name: 'X' })
    await user.clear(input)
    await user.type(input, '24')
    await user.tab()
    expect(onCommit).toHaveBeenCalledWith(24)
  })
})
