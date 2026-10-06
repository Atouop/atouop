# -*- coding: utf-8 -*-
"""QQ 数据源（NapCat OneBot v11 正向 WebSocket）。
需先在电脑上运行 NapCat（基于 QQNT），开启正向 WS（默认 3001）。"""
import json
import time


def _extract_text(evt):
    if evt.get('raw_message'):
        return evt['raw_message']
    segs = evt.get('message')
    if isinstance(segs, list):
        parts = []
        for s in segs:
            if s.get('type') == 'text':
                parts.append(s.get('data', {}).get('text', ''))
        return ''.join(parts)
    if isinstance(segs, str):
        return segs
    return ''


def run_qq(cfg, sink, log):
    if not cfg.get('enabled'):
        log('QQ 监听已禁用')
        return
    try:
        import websocket
    except Exception as e:
        log('websocket-client 未安装：%s' % e)
        return
    base = cfg.get('ws_url', 'ws://127.0.0.1:3001')
    token = cfg.get('access_token', '')
    want = set(cfg.get('groups', []))
    names = cfg.get('group_names', {})
    url = base
    if token:
        url += ('&' if '?' in url else '?') + 'access_token=' + token

    def on_message(ws, raw):
        try:
            evt = json.loads(raw)
        except Exception:
            return
        if evt.get('post_type') != 'message' or evt.get('message_type') != 'group':
            return
        gid = evt.get('group_id')
        if want and gid not in want:
            return
        group = names.get(str(gid), str(gid))
        text = _extract_text(evt)
        if text:
            sink.add('qq', group, text)

    def on_error(ws, e):
        log('QQ WS 错误：%s' % e)

    def on_open(ws):
        log('QQ 已连接 NapCat：%s' % base)

    def on_close(ws, *a):
        log('QQ WS 关闭，3 秒后重连')

    while True:
        ws = websocket.WebSocketApp(url, on_message=on_message, on_error=on_error,
                                    on_open=on_open, on_close=on_close)
        ws.run_forever(ping_interval=20, ping_timeout=10)
        time.sleep(3)
