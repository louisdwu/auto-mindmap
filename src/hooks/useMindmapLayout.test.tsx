// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { useMindmapLayout } from './useMindmapLayout';
import { LayoutOptions } from '../utils/layout';
import { MindmapViewStateService } from '../services/mindmapViewState';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const layoutOptions: LayoutOptions = {
  direction: 'right',
  horizontalSpacing: 140,
  verticalSpacing: 20,
  nodeWidth: 100,
  nodeHeight: 32,
  centerOffset: 0,
  levelSpacingMultiplier: 0.85,
  fontSizeBase: 1
};

const markdown = ['# 主题', '## 分支A', '- 要点1', '- 要点2', '## 分支B', '- 要点3'].join('\n');

type LayoutApi = ReturnType<typeof useMindmapLayout>;

interface ApiBox {
  api: LayoutApi | null;
}

/** 创建带尺寸的假容器（jsdom 下 clientHeight/clientWidth 默认为 0） */
function createContainer(): React.RefObject<HTMLDivElement> {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { value: 800, configurable: true });
  Object.defineProperty(element, 'clientWidth', { value: 1200, configurable: true });
  return { current: element } as unknown as React.RefObject<HTMLDivElement>;
}

const mountedRoots: Root[] = [];

function mount(viewStateKey: string | undefined, box: ApiBox): Root {
  const containerRef = createContainer();
  const root = createRoot(document.createElement('div'));
  const Harness: React.FC = () => {
    box.api = useMindmapLayout({ markdown, layoutOptions, containerRef, viewStateKey });
    return null;
  };
  act(() => {
    root.render(<Harness />);
  });
  mountedRoots.push(root);
  return root;
}

function unmount(root: Root) {
  act(() => {
    root.unmount();
  });
}

function isExpanded(api: LayoutApi, id: string): boolean {
  const node = api.treeData ? api.findNode(api.treeData, id) : null;
  return node?.expanded === true;
}

describe('useMindmapLayout 视图状态保持', () => {
  beforeEach(() => {
    MindmapViewStateService.clear();
  });

  afterEach(() => {
    mountedRoots.splice(0).forEach(root => unmount(root));
  });

  it('默认状态下子节点为折叠，仅中心主题展开', () => {
    const box: ApiBox = { api: null };
    mount(undefined, box);
    const api = box.api!;
    expect(api.treeData).not.toBeNull();
    expect(isExpanded(api, 'root')).toBe(true);
    expect(isExpanded(api, 'node-0')).toBe(false);
  });

  it('重新挂载后恢复之前展开的节点与对应布局', () => {
    const key = MindmapViewStateService.createKey(markdown);

    const first: ApiBox = { api: null };
    const firstRoot = mount(key, first);
    act(() => {
      first.api!.toggleNode('node-0', true);
    });
    expect(isExpanded(first.api!, 'node-0')).toBe(true);
    expect(first.api!.positions.has('node-1')).toBe(true);
    unmount(firstRoot);

    const second: ApiBox = { api: null };
    mount(key, second);
    expect(isExpanded(second.api!, 'node-0')).toBe(true);
    expect(isExpanded(second.api!, 'node-3')).toBe(false);
    expect(second.api!.positions.has('node-1')).toBe(true);
  });

  it('重新挂载后恢复缩放与画布偏移', () => {
    const key = MindmapViewStateService.createKey(markdown);

    const first: ApiBox = { api: null };
    const firstRoot = mount(key, first);
    act(() => {
      first.api!.setScale(1.4);
      first.api!.setOffset({ x: 88, y: 66 });
    });
    unmount(firstRoot);

    const second: ApiBox = { api: null };
    mount(key, second);
    expect(second.api!.scale).toBeCloseTo(1.4, 5);
    expect(second.api!.offset).toEqual({ x: 88, y: 66 });
  });

  it('未提供缓存键时不会记录或恢复任何状态', () => {
    const first: ApiBox = { api: null };
    const firstRoot = mount(undefined, first);
    act(() => {
      first.api!.toggleNode('node-0', true);
    });
    unmount(firstRoot);

    const second: ApiBox = { api: null };
    mount(undefined, second);
    expect(isExpanded(second.api!, 'node-0')).toBe(false);
    expect(MindmapViewStateService.size()).toBe(0);
  });

  it('折叠状态同样被记录（展开全部后再折叠，重挂载仍为折叠）', () => {
    const key = MindmapViewStateService.createKey(markdown);

    const first: ApiBox = { api: null };
    const firstRoot = mount(key, first);
    act(() => {
      first.api!.expandAll();
    });
    expect(isExpanded(first.api!, 'node-0')).toBe(true);
    act(() => {
      first.api!.collapseAll();
    });
    expect(isExpanded(first.api!, 'node-0')).toBe(false);
    unmount(firstRoot);

    const second: ApiBox = { api: null };
    mount(key, second);
    expect(isExpanded(second.api!, 'node-0')).toBe(false);
  });

  it('不同导图（不同缓存键）互不影响', () => {
    const keyA = MindmapViewStateService.createKey(`${markdown}\nA`);
    const keyB = MindmapViewStateService.createKey(`${markdown}\nB`);

    const first: ApiBox = { api: null };
    const firstRoot = mount(keyA, first);
    act(() => {
      first.api!.toggleNode('node-0', true);
    });
    unmount(firstRoot);

    const second: ApiBox = { api: null };
    mount(keyB, second);
    expect(isExpanded(second.api!, 'node-0')).toBe(false);
  });
});
