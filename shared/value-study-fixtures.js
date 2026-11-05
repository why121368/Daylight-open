// Original, fixed study inputs. Goldens stay on the local study server.
const instant = (day, time) => `2026-11-${String(day).padStart(2, '0')}T${time}:00+08:00`;
function makeSet(id, { day, organization, role, exchange, meeting, original, revised, busy, location, material, document }) {
  const prefix = `study-${id.toLowerCase()}`;
  const deadline = day - 1;
  const mail = (number, subject, body) => ({ id: `${prefix}-${number}`, subject,
    body, sender: `${organization} <study@example.invalid>`, receivedAt: `2026-11-04T09:${String(number * 5).padStart(2,'0')}:00+08:00` });
  const invitation = mail(1, `${role}面试邀请`, `你好！邀请你参加${organization}的${role}面试。北京时间2026年11月${day}日${original[0]}至${original[1]}，地点为${location}。请在2026年11月${deadline}日18:00前上传${material}。材料上传截止与面试时间分别安排。`);
  const documents = [invitation,
    mail(2, '补充材料截止通知', `补充通知：请在北京时间2026年11月${deadline}日17:00前上传${document}。这是另一项材料，与前信要求的${material}分别提交。面试时间和地点沿用原通知。`),
    mail(3, `${exchange}邀请`, `邀请你参加${exchange}。北京时间2026年11月${day}日${busy[0]}至${busy[1]}，地点为二楼讨论室。这场交流有独立时间，请核对已有日历后安排。`),
    mail(4, `${role}面试改期`, `${organization}通知：${role}面试由北京时间2026年11月${day}日${original[0]}至${original[1]}，改为同一天${revised[0]}至${revised[1]}。地点仍为${location}。请保留一次当前面试安排。两项材料截止不变，${exchange}不在本次调整范围。`),
    { ...invitation, repeated: true },
    mail(6, `${exchange}取消`, `通知：原定北京时间2026年11月${day}日${busy[0]}至${busy[1]}的${exchange}取消。该交流无须继续占用日历。${role}面试沿用改期通知，两项材料仍按原截止提交。`),
  ];
  const base = { id:`${prefix}-existing`,title:meeting, start:instant(day, busy[2]),end:instant(day,busy[3]),
    location:'已有会议室',source:'manual',status:'active',category:'work' };
  return { id, title:`通知组 ${id}`, timezone:'Asia/Shanghai', emails:documents, initialEvents:[base],
    golden:{ interview:{start:instant(day,revised[0]),end:instant(day,revised[1]),location},
      oldInterview:{start:instant(day,original[0]),end:instant(day,original[1])},
      exchange:{start:instant(day,busy[0]),end:instant(day,busy[1])},
      tasks:[{dueAt:instant(deadline,'18:00'),sourceId:invitation.id,topic:material},
        {dueAt:instant(deadline,'17:00'),sourceId:`${prefix}-2`,topic:document}],
      interviewSources:[`${prefix}-1`,`${prefix}-4`], expectedConflict:true,
    } };
}

export const STUDY_VERSION = 'daylight-value-study-20261104-v1';
export const STUDY_SETS = [
  makeSet('A',{ day:10,organization:'星河研究院',role:'研究助理',exchange:'实验室交流',meeting:'课题组例会',
    original:['10:00','10:30'],revised:['15:30','16:00'],busy:['14:15','14:45','14:00','15:00'],
    location:'线上会议室A',material:'一页研究经历',document:'成绩单PDF' }),
  makeSet('B',{ day:12,organization:'远航实验室',role:'项目助理',exchange:'项目组交流',meeting:'项目组例会',
    original:['15:00','15:30'],revised:['13:30','14:00'],busy:['09:15','09:45','09:00','10:00'],
    location:'线上会议室B',material:'一页项目经历',document:'课程表PDF' }),
];

export function studyOrder(participant) {
  if (!/^P(?:0[1-9]|[1-9]\d{1,2})$/.test(participant || '')) throw new Error('请使用P01至P999的匿名编号。');
  const orders = [ [['manual','A'],['daylight','B']], [['daylight','A'],['manual','B']],
    [['manual','B'],['daylight','A']], [['daylight','B'],['manual','A']] ];
  return orders[(Number(participant.slice(1))-1)%4].map(([condition,set])=>({condition,set}));
}

export function participantSet(set) {
  return {id:set.id,title:set.title,timezone:set.timezone,emails:structuredClone(set.emails),initialEvents:structuredClone(set.initialEvents)};
}

export function presetStudyExtraction(set,email,events) {
  const i = Number(email.id.split('-').at(-1));
  const base={summary:'练习模式预置提取',category:'meeting',intent:'calendar',events:[],tasks:[]};
  const title=set.emails[0].subject.replace('邀请','');
  if (i===1) return {...base,events:[{title,...set.golden.oldInterview,location:set.golden.interview.location}],
    tasks:[{title:`上传${set.golden.tasks[0].topic}`,dueAt:set.golden.tasks[0].dueAt}]};
  if (i===2) return {...base,tasks:[{title:`上传${set.golden.tasks[1].topic}`,dueAt:set.golden.tasks[1].dueAt}]};
  if (i===3) return {...base,events:[{title:set.emails[2].subject.replace('邀请',''),...set.golden.exchange,location:'二楼讨论室'}]};
  if (i===4) return {...base,events:[{action:'reschedule',targetEventId:events.find(e=>e.title===title&&e.status!=='cancelled')?.id,
    ...set.golden.interview,reason:'通知改期'}]};
  if (i===6) return {...base,events:[{action:'cancel',targetEventId:events.find(e=>e.title===set.emails[2].subject.replace('邀请','')&&e.status!=='cancelled')?.id,reason:'通知取消'}]};
  return base;
}
