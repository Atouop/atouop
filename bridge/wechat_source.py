# -*- coding: utf-8 -*-
"""微信数据源（wxauto）：监听 PC 微信指定群，新消息送入 sink。"""
import time


def run_wechat(cfg, sink, log):
    if not cfg.get('enabled'):
        log('微信监听已禁用')
        return
    groups = cfg.get('groups', [])
    if not groups:
        log('未配置微信监听群')
        return
    try:
        from wxauto import WeChat
    except Exception as e:
        log('wxauto 未安装或微信未登录：%s' % e)
        log('请先 pip install wxauto，并在电脑上登录微信后重试')
        return
    wx = WeChat()
    for g in groups:
        try:
            wx.AddListenChat(who=g)
            log('微信监听已添加：%s' % g)
        except Exception as e:
            log('添加监听失败【%s】：%s' % (g, e))
    while True:
        try:
            msgd = wx.GetListenMessage()
            for chat, msgs in (msgd or {}).items():
                cname = getattr(chat, 'name', None) or getattr(chat, 'Name', None) \
                    or getattr(chat, 'title', None) or ''
                for m in msgs:
                    if getattr(m, 'type', '') in ('time', 'system'):
                        continue
                    content = getattr(m, 'content', '') or ''
                    if content:
                        sink.add('wechat', cname, content)
        except Exception as e:
            log('微信轮询异常：%s' % e)
        time.sleep(0.8)
