import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage, Layer, Rect, Line, Text, Group } from 'react-konva';
import { io } from 'socket.io-client';
import './style.css';
import { dragPoints } from './geometry.js';
import { TouchIntent, resizeView } from './touch.js';

const W = 2400, H = 1600;
const COLORS = ['#323a37', '#ee795c', '#e7b84b', '#649982', '#589bb8', '#8c79bd', '#d789a6', '#ffffff'];
let token = localStorage.getItem('wall-token');
if (!/^[a-f0-9]{64}$/.test(token || '')) {
  token = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('wall-token', token);
}
const socket = io({ auth: { token }, autoConnect: false });
const paths = {
  pen: <><path d="m4 16-1 5 5-1L20 8l-4-4L4 16Z"/><path d="m13 7 4 4M4 16l4 4"/></>,
  eraser: <><path d="m3 14 10-11 8 8-10 10H8zM8 9l8 8M12 21h9"/></>,
  line: <><path d="m4 20 16-16"/><circle cx="4" cy="20" r="1"/><circle cx="20" cy="4" r="1"/></>,
  circle: <circle cx="12" cy="12" r="8"/>,
  polygon: <path d="m12 3 9 7-4 11H7L3 10z"/>,
  hand: <><path d="M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-4 3-2l2 2"/></>,
  undo: <><path d="M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12"/></>,
  minus: <path d="M5 12h14"/>, plus: <path d="M5 12h14M12 5v14"/>,
  fit: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path d="M8 8h8v8H8z"/></>,
  share: <><path d="m14 3 5 5-5 5M19 8h-8a6 6 0 0 0-6 6v2"/><path d="M12 18v3H3V9h3"/></>,
  arrow: <path d="m5 3 14 10-7 1-3 7L5 3Z"/>,
};
function Icon({ name, size = 20 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }

function App() {
  const wrap = useRef(null), current = useRef(null), pointers = useRef(new Map()), gesture = useRef(null), lastSent = useRef(0), lastCursor = useRef(0);
  const pending = useRef(new Map()), startPoint = useRef(null), actions = useRef({});
  const touch = useRef(new TouchIntent()), lastSize = useRef(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [polygonCount, setPolygonCount] = useState(0);
  const [size, setSize] = useState({ width: 1000, height: 650 });
  const [view, setView] = useState({ x: 50, y: 50, scale: .35 });
  const viewRef = useRef(view); viewRef.current = view;
  const [strokes, setStrokes] = useState({}), [live, setLive] = useState({}), [cursors, setCursors] = useState({});
  const [people, setPeople] = useState([]), [me, setMe] = useState(null), [connected, setConnected] = useState(false);
  const [color, setColor] = useState(COLORS[0]), [width, setWidth] = useState(3), [tool, setTool] = useState('pen');
  const [space, setSpace] = useState(false), [notice, setNotice] = useState(''), [saving, setSaving] = useState(0);
  const isPan = tool === 'hand' || space;
  const remove = (setter, id) => setter(old => { const next = { ...old }; delete next[id]; return next; });
  const fit = (s = size) => { const scale = Math.max(s.width / W, s.height / H); setView({ x: (s.width - W * scale) / 2, y: (s.height - H * scale) / 2, scale }); };
  const persist = stroke => {
    pending.current.set(stroke.id, stroke); setSaving(pending.current.size);
    if (!socket.connected) return;
    socket.timeout(5000).emit('stroke:commit', stroke, (err, result) => {
      if (!err && result?.ok) { pending.current.delete(stroke.id); setSaving(pending.current.size); }
      else if (!err) setNotice(result?.error || '保存失败，将自动重试');
    });
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const s = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(s);
      if (!lastSize.current) fit(s);
      else { const before = lastSize.current; setView(v => resizeView(v, before, s)); }
      lastSize.current = s;
    });
    observer.observe(wrap.current);
    const onSnapshot = data => {
      setMe(data.me); setConnected(true);
      setStrokes(Object.fromEntries([...data.strokes, ...pending.current.values()].map(s => [s.id, s])));
      setLive(Object.fromEntries(data.active.map(s => [s.id, s]))); setCursors({});
      for (const s of pending.current.values()) persist(s);
    };
    const onPreview = s => setLive(old => ({ ...old, [s.id]: s }));
    const onCommit = s => { setStrokes(old => ({ ...old, [s.id]: s })); remove(setLive, s.id); };
    const onRemove = id => { remove(setStrokes, id); remove(setLive, id); };
    const onCursor = p => setCursors(old => ({ ...old, [p.id]: { ...p, seen: Date.now() } }));
    const onLeave = id => remove(setCursors, id);
    const disconnected = () => {
      if (current.current && current.current.kind !== 'polygon') { const s = current.current; pending.current.set(s.id, s); setSaving(pending.current.size); setStrokes(old => ({ ...old, [s.id]: s })); }
      setConnected(false); current.current = null; setPolygonCount(0); setLive({}); pointers.current.clear(); touch.current.reset(); gesture.current = null;
    };
    socket.on('snapshot', onSnapshot).on('people', setPeople).on('stroke:preview', onPreview).on('stroke:commit', onCommit).on('stroke:remove', onRemove).on('cursor', onCursor).on('cursor:leave', onLeave).on('disconnect', disconnected).on('connect_error', disconnected);
    socket.connect();
    const retry = setInterval(() => {
      if (socket.connected) for (const s of pending.current.values()) persist(s);
      setCursors(old => Object.fromEntries(Object.entries(old).filter(([, p]) => Date.now() - p.seen < 8000)));
    }, 6000);
    return () => { observer.disconnect(); clearInterval(retry); socket.removeAllListeners(); socket.disconnect(); };
  }, []);
  const undo = () => { if (!socket.connected || pending.current.size || current.current) return; socket.timeout(5000).emit('stroke:undo', (err, result) => { if (err || result?.error) setNotice('撤销未确认，请检查连接'); }); };
  useEffect(() => {
    const down = e => {
      if (e.target.closest('input,textarea,[contenteditable=true]')) return;
      if (e.code === 'Space' && e.target.closest('button')) return;
      if (e.code === 'Space') { e.preventDefault(); setSpace(true); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      if (e.key === 'Escape') actions.current.cancel();
      if (e.key === 'Enter') actions.current.closePolygon();
      const shortcut = { b: 'pen', h: 'hand', e: 'eraser', l: 'line', c: 'circle', p: 'polygon' }[e.key.toLowerCase()];
      if (shortcut && !e.metaKey && !e.ctrlKey) actions.current.selectTool(shortcut);
    };
    const up = e => { if (e.code === 'Space') setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(timeout); }, [notice]);
  const local = e => { const r = wrap.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const world = p => { const v = viewRef.current; return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale }; };
  const inside = p => p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H;
  const cancel = () => {
    const s = current.current; current.current = null; setPolygonCount(0);
    if (s) { remove(setLive, s.id); socket.emit('stroke:cancel', s.id); }
  };
  const selectTool = next => { cancel(); setTool(next); };
  const closePolygon = () => {
    if (current.current?.kind !== 'polygon' || current.current.points.length < 6) return;
    finish(); setPolygonCount(0);
  };
  actions.current = { cancel, selectTool, closePolygon };
  const finish = () => {
    const s = current.current; current.current = null;
    if (!s) return;
    setStrokes(old => ({ ...old, [s.id]: s })); remove(setLive, s.id); persist(s);
  };
  const beginStroke = p => {
    const point = world(p);
    if (!inside(point) || !connected) return;
    if (tool === 'polygon' && current.current) {
      const s = current.current;
      if (s.points.length >= 6 && (Math.hypot(point.x - s.points[0], point.y - s.points[1]) * view.scale < 12 || Math.hypot(point.x - s.points.at(-2), point.y - s.points.at(-1)) * view.scale < 8)) { closePolygon(); return; }
      const next = { ...s, points: [...s.points, point.x, point.y] };
      current.current = next; setPolygonCount(next.points.length / 2); setLive(old => ({ ...old, [s.id]: next })); socket.emit('stroke:preview', next); return;
    }
    startPoint.current = point;
    const s = { id: crypto.randomUUID(), owner: me.id, kind: tool, color, width: tool === 'eraser' ? Math.min(32, width * 2) : width, points: [point.x, point.y, point.x + (point.x < W ? .01 : -.01), point.y] };
    if (tool === 'polygon') { s.points = [point.x, point.y]; setPolygonCount(1); }
    current.current = s; setLive(old => ({ ...old, [s.id]: s })); socket.emit('stroke:preview', s);
  };
  const down = e => {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e); pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      touch.current.pinch();
      if (current.current?.kind !== 'polygon') cancel();
      gesture.current = null; return;
    }
    if (touch.current.pinching) return;
    if (isPan) { gesture.current = { pan: p }; return; }
    if (e.pointerType === 'touch') { touch.current.begin(p); return; }
    beginStroke(p);
  };
  const move = e => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current?.distance) {
        const v = viewRef.current, prev = gesture.current;
        const scale = Math.max(.1, Math.min(3, v.scale * distance / prev.distance));
        setView({ scale, x: center.x - (prev.center.x - v.x) / v.scale * scale, y: center.y - (prev.center.y - v.y) / v.scale * scale });
      }
      gesture.current = { center, distance }; return;
    }
    if (touch.current.pinching) return;
    if (gesture.current?.pan && pointers.current.size) {
      const prev = gesture.current.pan; setView(v => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y })); gesture.current = { pan: p }; return;
    }
    if (e.pointerType === 'touch') {
      if (tool === 'polygon') return; // Vertices are taps, never drags or pinch starts.
      const start = touch.current.drag(p);
      if (start) beginStroke(start);
    }
    const point = world(p), now = Date.now();
    if (connected && inside(point) && now - lastCursor.current > 50) { socket.volatile.emit('cursor', point); lastCursor.current = now; }
    if (!current.current) return;
    const s = current.current, x = Math.max(0, Math.min(W, point.x)), y = Math.max(0, Math.min(H, point.y));
    if (Math.hypot(x - s.points.at(-2), y - s.points.at(-1)) < 1) return;
    const points = s.kind === 'line' || s.kind === 'circle' ? dragPoints(s.kind, startPoint.current, { x, y }) : [...s.points, x, y];
    const next = { ...s, points };
    if (s.kind !== 'polygon') current.current = next;
    setLive(old => ({ ...old, [s.id]: next }));
    if (now - lastSent.current > 40) { socket.volatile.emit('stroke:preview', next); lastSent.current = now; }
    if (next.points.length >= 11998) { finish(); setNotice('这一笔已保存，可以继续落笔'); }
  };
  const up = e => {
    pointers.current.delete(e.pointerId);
    if (e.pointerType === 'touch') {
      const tap = touch.current.end(local(e), pointers.current.size);
      if (tap && !isPan) beginStroke(tap);
    }
    if (current.current?.kind !== 'polygon') finish();
    gesture.current = null;
  };
  const cancelPointer = () => {
    pointers.current.clear(); touch.current.reset(); gesture.current = null;
    if (current.current?.kind !== 'polygon') cancel();
  };
  const zoom = (factor, point = { x: size.width / 2, y: size.height / 2 }) => {
    setView(v => { const scale = Math.max(.1, Math.min(3, v.scale * factor)); return { scale, x: point.x - (point.x - v.x) / v.scale * scale, y: point.y - (point.y - v.y) / v.scale * scale }; });
  };
  useEffect(() => {
    const el = wrap.current;
    const wheel = e => { e.preventDefault(); zoom(Math.exp(-e.deltaY * .0015), local(e)); };
    el.addEventListener('wheel', wheel, { passive: false }); return () => el.removeEventListener('wheel', wheel);
  }, []);
  const ownCount = Object.values(strokes).filter(s => s.owner === me?.id).length;
  const drawStroke = s => <Line key={s.id} points={s.points} stroke={s.color} strokeWidth={s.width} lineCap="round" lineJoin="round" tension={!s.kind || s.kind === 'pen' ? .25 : 0} closed={s.kind === 'polygon' && s.points.length >= 6} globalCompositeOperation={s.kind === 'eraser' ? 'destination-out' : 'source-over'} listening={false}/>;
  return <div className="app">
    <header>
      <div className="brand"><span className="brand-icon"><Icon name="pen" size={16}/></span><h1>一起涂<span className="brand-dot">.</span></h1></div>
      <div className="header-right"><div className="online"><span className={connected ? 'status-dot' : 'status-dot offline'}/><b>{connected ? people.length : '—'}</b> 人在线</div></div>
    </header>
    <main>
      <div className={`canvas-wrap ${isPan ? 'pan' : ''}`} ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelPointer} onDoubleClick={closePolygon}>
        <Stage width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}>
          <Layer listening={false}><Rect width={W} height={H} fill="#fffefb" shadowColor="#26372a" shadowBlur={50} shadowOpacity={.08} shadowOffsetY={10}/><Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
            {Array.from({ length: 59 }, (_, i) => <Line key={`v${i}`} points={[(i + 1) * 40, 0, (i + 1) * 40, H]} stroke="#f3f1eb" strokeWidth={1}/>)}
            {Array.from({ length: 39 }, (_, i) => <Line key={`h${i}`} points={[0, (i + 1) * 40, W, (i + 1) * 40]} stroke="#f3f1eb" strokeWidth={1}/>)}
          </Group></Layer>
          <Layer listening={false}><Group clipX={0} clipY={0} clipWidth={W} clipHeight={H}>
            {Object.values(strokes).filter(s => !live[s.id]).sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity)).map(drawStroke)}{Object.values(live).map(drawStroke)}
          </Group></Layer>
          <Layer listening={false}>{Object.values(cursors).map(p => <Group key={p.id} x={p.x} y={p.y} scaleX={1 / view.scale} scaleY={1 / view.scale}><Line points={[0, 0, 4, 17, 8, 10, 16, 9, 0, 0]} fill={p.color} closed stroke="#fff" strokeWidth={1.5}/><Rect x={12} y={17} width={92} height={25} fill={p.color} cornerRadius={6}/><Text x={19} y={24} text={p.name} fontSize={11} fill="white"/></Group>)}</Layer>
        </Stage>
      </div>
      {!Object.keys(strokes).length && !Object.keys(live).length && <div className="empty"><span className="empty-spark">✳</span><h2>第一笔，交给你。</h2><p>选个喜欢的颜色，随便画点什么。<br/>你的灵感，会成为这面墙的一部分。</p><span className="empty-arrow">↙</span></div>}
      <aside className={`toolbar ${optionsOpen ? 'options-open' : ''}`} aria-label="绘画工具">
        <div className="tool-group">{[['pen', '画笔 (B)'], ['eraser', '橡皮擦 (E)'], ['line', '直线 (L)'], ['circle', '圆：从圆心拖动 (C)'], ['polygon', '多边形：逐点点击，双击闭合 (P)'], ['hand', '移动画布 (H)']].map(([name, label]) => <button key={name} aria-label={label} title={label} aria-pressed={tool === name} className={tool === name ? 'selected' : ''} onClick={() => selectTool(name)}><Icon name={name}/></button>)}<button className="mobile-undo" aria-label="撤销自己的上一笔" disabled={!ownCount || !connected || saving > 0} onClick={undo}><Icon name="undo"/></button></div>
        <button className="mobile-options-toggle" aria-expanded={optionsOpen} aria-controls="paint-options" onClick={() => setOptionsOpen(v => !v)}><span style={{ background: color }}/>{optionsOpen ? '收起颜色与笔宽' : '颜色与笔宽'}<span aria-hidden="true">{optionsOpen ? '⌄' : '⌃'}</span></button>
        <div className="paint-options" id="paint-options">
        <div className="divider"/><div className="colors">{COLORS.map(c => <button key={c} aria-label={`颜色 ${c}`} aria-pressed={color === c} title={c === '#ffffff' ? '白色画笔' : c} className={`swatch ${color === c ? 'chosen' : ''}`} style={{ '--swatch': c }} onClick={() => { setColor(c); if (tool === 'eraser') selectTool('pen'); }}/>)}</div>
        <label className="color-picker" title="调色盘：选择任意颜色" style={{ '--chosen-color': color }}><input type="color" aria-label="调色盘" value={color} onChange={e => { setColor(e.target.value); if (tool === 'eraser') selectTool('pen'); }}/><span aria-hidden="true">＋</span></label>
        <div className="divider"/><div className="widths">{[3, 8, 16].map(n => <button key={n} aria-label={`画笔粗细 ${n}`} aria-pressed={width === n} className={width === n ? 'width-selected' : ''} onClick={() => setWidth(n)}><span style={{ width: n / 1.5 + 2, height: n / 1.5 + 2 }}/></button>)}</div>
        </div><div className="divider"/><button className="desktop-undo" aria-label="撤销自己的上一笔" title="撤销自己的上一笔 (⌘/Ctrl Z)" disabled={!ownCount || !connected || saving > 0} onClick={undo}><Icon name="undo"/></button>
      </aside>
      {tool === 'polygon' && <div className="polygon-controls"><span>{polygonCount ? '点击添加顶点，再点「完成」' : '点击画布，开始绘制多边形'}</span>{polygonCount > 0 && <><button disabled={polygonCount < 3} onClick={closePolygon}>完成</button><button onClick={cancel}>取消</button></>}</div>}
      <div className="zoom"><button aria-label="缩小" onClick={() => zoom(.8)}><Icon name="minus" size={16}/></button><span>{Math.round(view.scale * 100)}%</span><button aria-label="放大" onClick={() => zoom(1.25)}><Icon name="plus" size={16}/></button><i/><button aria-label="适应窗口" title="适应窗口" onClick={() => fit()}><Icon name="fit" size={17}/></button></div>
      {notice && <div className="toast" role="status">{notice}</div>}
      {!connected && <div className="connection-banner" role="status">正在连接涂鸦墙… 连接后就能开始画</div>}
    </main>
    <footer><div><span className={`status-dot ${!connected || saving ? 'offline' : ''}`}/>{!connected ? '连接中' : saving ? `${saving} 笔正在保存…` : '已连接 · 自动保存'}<span className="footer-sep">/</span><span>{me?.name || '匿名画友'}</span></div><span className="desktop-hint">拖动画画 <kbd>Space</kbd> 移动画布 · 滚轮缩放</span><span className="mobile-hint">单指画画 · 双指移动与缩放</span><span className="footer-love">给世界，添一点颜色 <span>✳</span></span></footer>
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
