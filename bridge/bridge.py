# -*- coding: utf-8 -*-
"""Atouop 本地桥接主程序。
在登录着微信/QQ 的 Windows 电脑上运行：
    python bridge.py
它会实时监听配置的群，把待办与调课事件推送到云端，首页分屏自动刷新。"""
import json
import os
import sys
import time
import threading

import requests

import extractor
import wechat_source
import qq_source

HERE = os.path.dirname(os.path.abspath(__file__))


def log(msg):
    print('[bridge] %s  %s' % (time.strftime('%H:%M:%S'), msg), flush=True)


class Sink:
    def __init__(self, identity, include_undated):
        self.identity = identity
        self.include_undated = include_undated
        self.tasks = {}
        self.events = {}
        self.lock = threading.Lock()

    def add(self, source, group, text):
        task, event = extractor.extract_message(
            text, source, group, self.identity, self.include_undated)
        now_ms = int(time.time() * 1000)
        with self.lock:
            if task:
                task['ts'] = now_ms
                self.tasks[task['id']] = task
            if event:
                event['ts'] = now_ms
                if not event.get('id'):
                    event['id'] = extractor.stable_id(
                        source, group, event['text'], event.get('date'))
                self.events[event['id']] = event

    def drain(self):
        with self.lock:
            t = list(self.tasks.values())
            e = list(self.events.values())
            self.tasks.clear()
            self.events.clear()
        return t, e


def main():
    cfg_path = os.path.join(HERE, 'config.json')
    if not os.path.exists(cfg_path):
        log('未找到 config.json，请把 config.example.json 复制为 config.json 并填写')
        sys.exit(1)
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    base = cfg.get('base_url', '').rstrip('/')
    secret = cfg.get('secret', '')
    if not base or not secret:
        log('请在 config.json 填写 base_url 和 secret')
        sys.exit(1)
    endpoint = base + '/api/bridge'
    identity = cfg.get('identity', {})
    sink = Sink(identity, cfg.get('include_undated', True))
    flush_seconds = int(cfg.get('flush_seconds', 3))

    def flusher():
        last_beat = 0
        while True:
            time.sleep(flush_seconds)
            tasks, events = sink.drain()
            # 没有新内容时，每 15 秒发一次心跳
            if not tasks and not events and time.time() - last_beat < 15:
                continue
            last_beat = time.time()
            payload = {'account': cfg.get('account', ''),
                       'identity': identity, 'tasks': tasks, 'events': events, 'online': True}
            try:
                r = requests.post(endpoint, json=payload,
                                  headers={'X-Bridge-Secret': secret}, timeout=15)
                if r.status_code == 200:
                    if tasks or events:
                        log('已推送 %d 待办 / %d 事件' % (len(tasks), len(events)))
                else:
                    log('推送失败 %s：%s' % (r.status_code, r.text[:120]))
                    # 失败回滚，下轮重试
                    for t in tasks:
                        sink.tasks[t['id']] = t
                    for e in events:
                        sink.events[e['id']] = e
            except Exception as e:
                log('推送异常：%s' % e)
                for t in tasks:
                    sink.tasks[t['id']] = t
                for e in events:
                    sink.events[e['id']] = e

    threading.Thread(target=flusher, daemon=True).start()

    # QQ 在独立线程
    if cfg.get('qq', {}).get('enabled'):
        threading.Thread(target=qq_source.run_qq,
                         args=(cfg['qq'], sink, log), daemon=True).start()

    # 微信在主线程（UI 自动化）
    if cfg.get('wechat', {}).get('enabled'):
        wechat_source.run_wechat(cfg['wechat'], sink, log)
    else:
        while True:
            time.sleep(1)


if __name__ == '__main__':
    main()
