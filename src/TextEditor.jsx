import React, { useRef } from 'react';

export function TextEditor({ draft, onChange, onSave, onCancel }) {
  const composing = useRef(false);
  const keyDown = event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onSave(); }
    if (event.key === 'Tab') {
      const controls = [...event.currentTarget.querySelectorAll('textarea, select, input, button:not(:disabled)')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  return <div className="text-editor-backdrop">
    <form className="text-editor" role="dialog" aria-modal="true" aria-labelledby="text-editor-title" onKeyDown={keyDown} onSubmit={e => { e.preventDefault(); if (!composing.current) onSave(); }}>
      <div className="text-editor-heading"><strong id="text-editor-title">添加文字</strong><span>文字会放在刚才点击的位置</span></div>
      <textarea autoFocus aria-label="文字内容" placeholder="写点什么吧…" rows={3} maxLength={500} value={draft.text} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={e => onChange({ ...draft, text: e.target.value })}/>
      <div className="text-editor-controls">
        <label>字号 <select aria-label="文字字号" value={draft.fontSize} onChange={e => onChange({ ...draft, fontSize: Number(e.target.value) })}>{[24, 40, 64, 96].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>颜色 <input type="color" aria-label="文字颜色" value={draft.color} onChange={e => onChange({ ...draft, color: e.target.value })}/></label>
        <span className="text-count">{draft.text.length}/500</span>
      </div>
      <div className="text-editor-actions"><span>支持换行 · Ctrl/⌘ Enter 完成</span><button type="button" onClick={onCancel}>取消</button><button className="text-save" type="submit" disabled={!draft.text.trim()}>放到画布</button></div>
    </form>
  </div>;
}
