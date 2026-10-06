# -*- coding: utf-8 -*-
"""消息提取：从微信/QQ群消息中识别待办、调课事件，并按身份过滤。
纯逻辑，不依赖任何平台，供微信/QQ 数据源共用。"""
import re
import hashlib
from datetime import date, timedelta

# 动作/任务关键词
TASK_KW = ['作业', '提交', '上交', '完成', '预习', '复习', '背诵', '默写', '准备', '带', '穿',
           '集合', '报名', '缴费', '填写', '上传', '打印', '签到', '考试', '测验', '测试', '演讲',
           '汇报', '答辩', '选课', '申请', '盖章', '阅读', '截止', '务必', '通知', '安排', '注意',
           '回答', '写', '做', '看', '交', '整理', '记住', '记得']

# 噪声（整句）
NOISE_RE = re.compile(r'^(\[.+\]|收到|好的|谢谢|不谢|不客气|嗯+|哦+|哈哈+|好嘞|对的|是的|可以|'
                      r'收到了|谢谢老师|感谢|辛苦了|打卡|已打卡|接龙|[0-9]+\s*[\.。]?)\s*[!！.。~]*$')

CN_NUM = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7}


def _dstr(d):
    return d.strftime('%Y-%m-%d')


def is_task(text):
    t = text.strip()
    if len(t) < 3:
        return False
    if NOISE_RE.match(t):
        return False
    if re.match(r'^\[.+\]$', t):
        return False
    return any(k in t for k in TASK_KW)


def infer_due(text, today=None):
    """返回 YYYY-MM-DD 或 None。"""
    today = today or date.today()
    if re.search(r'今天|今晚|今日', text):
        return _dstr(today)
    if re.search(r'明天|明晚', text):
        return _dstr(today + timedelta(days=1))
    if '后天' in text:
        return _dstr(today + timedelta(days=2))
    m = re.search(r'(?:星期|周)\s*([一二三四五六天日])', text)
    if m:
        target = CN_NUM[m.group(1)]
        cur = today.isoweekday()
        diff = (target - cur) % 7
        if diff == 0:
            diff = 7
        return _dstr(today + timedelta(days=diff))
    m = re.search(r'(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]', text)
    if m:
        mm, dd = int(m.group(1)), int(m.group(2))
        cand = date(today.year, mm, dd)
        if cand < today:
            cand = date(today.year + 1, mm, dd)
        return _dstr(cand)
    return None


def _extract_course(text):
    """从调课消息里粗略提取课程关键词。"""
    t = re.sub(r'(?:星期|周)\s*[一二三四五六天日]', '', text)
    t = re.sub(r'\d{1,2}\s*月\s*\d{1,2}\s*[日号]', '', t)
    t = t.replace('的', ' ')
    m = re.search(r'([\u4e00-\u9fa5A-Za-z0-9]{2,8}?)课', t)
    if m:
        return m.group(1) + '课'
    m = re.search(r'([\u4e00-\u9fa5A-Za-z0-9]{2,8})', t)
    if m:
        return m.group(1)
    return ''


def classify_event(text):
    """识别调课/停课/换教室/补课，返回事件 dict 或 None。"""
    t = text.strip()
    ev_date = infer_due(t)
    course = _extract_course(t)
    if re.search(r'停课|取消.*课|不上了|停上', t):
        return {'kind': 'cancel' if course else 'note', 'course': course, 'date': ev_date, 'text': t}
    if re.search(r'补课|加.*课|补.*上', t):
        return {'kind': 'add', 'course': course or '补课', 'date': ev_date, 'text': t}
    m = re.search(r'补到\s*([\u4e00-\u9fa5A-Za-z0-9号楼室馆]{2,12})', t)
    if m:
        return {'kind': 'add', 'course': course or '补课', 'room': m.group(1),
                'date': ev_date, 'text': t}
    m = re.search(r'(?:改到|换到|调整到|地点改到|上课地点改到)\s*([\u4e00-\u9fa5A-Za-z0-9号楼室馆]{2,12})', t)
    if m:
        return {'kind': 'room' if course else 'note', 'course': course, 'room': m.group(1),
                'date': ev_date, 'text': t}
    if re.search(r'换教室|教室调整|上课地点|调课|调整教室', t):
        return {'kind': 'note', 'course': course, 'date': ev_date, 'text': t}
    return None


def identity_filter(text, identity):
    """结合身份判断是否与本人相关。返回 True 表示保留。"""
    name = (identity or {}).get('name', '')
    sid = (identity or {}).get('student_id', '')
    roles = (identity or {}).get('roles', [])
    # 面向全体：保留
    if re.search(r'全体|大家|各位|同学们|全班|所有人', text):
        return True
    # 点名本人
    if name and name in text:
        return True
    if sid and str(sid) in text:
        return True
    # 面向本人担任的职务
    for r in roles:
        if r and r in text:
            return True
    # @了某个具体的人且不是本人：丢弃
    m = re.findall(r'@([\u4e00-\u9fa5A-Za-z0-9]{2,12})', text)
    if m:
        if name and name in m:
            return True
        return False
    # 无明确对象的动作类通知，默认保留
    return True


def stable_id(source, group, text, due):
    raw = '%s|%s|%s|%s' % (source, group, due or '', text.strip())
    return hashlib.sha1(raw.encode('utf-8')).hexdigest()[:16]


def extract_message(text, source, group, identity, include_undated=True):
    """对一条消息做完整处理，返回 (task, event)：可能其中一个为 None。"""
    t = text.strip()
    if not identity_filter(t, identity):
        return None, None
    task = None
    event = classify_event(t)
    if is_task(t):
        due = infer_due(t)
        if due or include_undated:
            task = {'id': stable_id(source, group, t, due), 'text': t, 'due': due,
                    'source': source, 'group': group}
    return task, event
