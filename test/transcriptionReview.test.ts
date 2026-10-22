import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcriptionReview, reviewClock, createReviewPlayback } from '../client/src/lib/transcriptionReview.js';

test('review orders all 48 passages by audio time and includes only overlapping raw context', () => {
  const issues = Array.from({length:48}, (_,n) => ({kind:'uncertain',start:n*10,end:n*10+3,message:'Check speech'})).reverse();
  const before = JSON.stringify(issues);
  const result = transcriptionReview({issues}, [{start:0,end:8,text:'Earlier words.'},{start:8,end:12,text:'Flagged speech.'},{start:15,end:20,text:'Later words.'}]);
  assert.equal(result.passages.length,48);
  assert.equal(result.passages[0].start,0);
  assert.deepEqual([result.passages[1].start,result.passages[1].end],[8,15]);
  assert.equal(result.passages[1].text,'Flagged speech.');
  assert.equal(result.passages[47].issue.start,470);
  assert.equal(JSON.stringify(issues),before);
  assert.equal(reviewClock(3601.9),'60:01');
});

test('review bounds long clips, preserves empty alternates, and deduplicates untimed warnings', () => {
  const result = transcriptionReview({preparation:{durationSec:100},issues:[
    {kind:'uncertain',start:5,end:95,alternative:''},
    {kind:'uncovered_audio',start:98,end:105},
    ...Array.from({length:3},()=>({kind:'timing',message:'Invalid timing'})),
    {start:NaN,end:10,message:'Unknown time'}, {start:-1,end:5}, {start:1,end:0}, {start:Infinity,end:Infinity}, {start:101,end:105}, null,
  ]});
  assert.equal(result.passages.length,2);
  assert.deepEqual([result.passages[0].start,result.passages[0].end,result.passages[0].truncated],[3,48,true]);
  assert.equal(result.passages[0].issue.alternative,'');
  assert.equal(result.passages[1].end,100);
  assert.equal(result.passages[1].truncated,false,'recording boundary does not claim a 45-second preview');
  assert.equal(result.notes[0].count,3);
  assert.deepEqual(transcriptionReview(null),{passages:[],notes:[]});
});

class Player extends EventTarget {
  currentTime=0; duration=90; readyState=1; paused=true; seeking=false; calls=0;
  reject=false;
  async play() { this.calls++; if(this.reject) throw Error('blocked'); this.paused=false; }
  pause() { this.paused=true; this.dispatchEvent(new Event('pause')); }
  emit(name:string) { this.dispatchEvent(new Event(name)); }
}
test('review plays a bounded excerpt, replays, and releases normal playback after navigation', async () => {
  const player = new Player(), states:any[]=[];
  const review = createReviewPlayback(state=>states.push(state));
  review.play(player,{start:10,end:15}); await Promise.resolve();
  assert.equal(player.currentTime,10); assert.equal(player.paused,false);
  player.currentTime=15; player.emit('timeupdate');
  assert.equal(player.paused,true); assert.equal(states.at(-1).playing,false);
  review.play(player,{start:10,end:15}); await Promise.resolve();
  assert.equal(player.currentTime,10);
  review.stop();
  await player.play(); player.currentTime=40; player.emit('timeupdate');
  assert.equal(player.paused,false,'normal audio is not capped after review ends');
});
test('manual seek and source replacement release review ownership', async () => {
  const player=new Player(), review=createReviewPlayback(()=>{});
  review.play(player,{start:10,end:15}); await Promise.resolve();
  player.seeking=true; player.currentTime=60; player.emit('timeupdate'); player.emit('seeked'); player.seeking=false;
  player.emit('timeupdate'); assert.equal(player.paused,false);
  review.play(player,{start:10,end:15}); await Promise.resolve();
  player.emit('emptied'); assert.equal(player.paused,true);
  await player.play(); player.currentTime=30; player.emit('timeupdate'); assert.equal(player.paused,false);
});
test('metadata wait is cancellable, repeated events do not replay, and duration is respected', async () => {
  const player=new Player(), states:any[]=[], review=createReviewPlayback(state=>states.push(state));
  player.readyState=0;
  review.play(player,{start:10,end:15}); assert.equal(player.calls,0);
  review.stop(); player.emit('loadedmetadata'); assert.equal(player.calls,0);
  review.play(player,{start:10,end:15}); player.emit('loadedmetadata'); player.emit('loadedmetadata'); await Promise.resolve();
  assert.equal(player.calls,1); review.stop();
  player.readyState=1; player.duration=12;
  review.play(player,{start:10,end:15}); await Promise.resolve();
  player.currentTime=12; player.emit('timeupdate'); assert.equal(player.paused,true);
  review.play(player,{start:12,end:15}); assert.ok(states.at(-1).error); assert.equal(player.calls,2);
});
test('play rejection and unavailable audio leave a retryable error, not a playing state', async () => {
  const player=new Player(), states:any[]=[], review=createReviewPlayback(state=>states.push(state));
  player.reject=true; review.play(player,{start:1,end:5}); await Promise.resolve();
  assert.equal(states.at(-1).playing,false); assert.ok(states.at(-1).error);
  player.reject=false; review.play(player,{start:1,end:5}); await Promise.resolve();
  assert.equal(states.at(-1).error,''); review.stop();
  review.play(null,{start:1,end:5}); assert.ok(states.at(-1).error);
  review.play(player,{start:NaN,end:5}); assert.ok(states.at(-1).error);
});
