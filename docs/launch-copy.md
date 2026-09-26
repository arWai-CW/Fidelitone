# Launch copy

Drafts for the moment the repo goes public. Written to the positioning
established in the README: **the pitch shifting is Signalsmith Stretch's work,
and the README says so.** What follows is about what this project actually
does, which is defensible line by line.

If you want the sharper comparative angle, it belongs in a social post where it
is your own voice and you can hedge informally. It does not belong in the
README or the store listing, for three reasons:

1. **You do not know their current state.** Whether a given extension is open
   source, paid, or still maintained is a verifiable fact, and a wrong claim is
   the kind of thing a reader remembers.
2. **Comparative claims are regulated in some jurisdictions**, and the Chrome
   Web Store rejects unverified claims outright.
3. **It reads as bragging, and bragging costs credibility.** The thing that
   makes a technical claim persuasive is that it is checkable. "Their voice
   breaks" is not checkable. "I measured my own latency, found the README was
   lying, and changed it" is.

---

## Show HN

**Title**

```
Fidelitone – pitch-shift any tab in Chrome, with the bass actually staying solid
```

**Body**

```
I built a Chrome extension for singing along: shift the pitch of whatever is
playing in a tab, up or down, without touching the tempo.

github.com/arWai-CW/fidelitone   (MIT, popup opens directly to the screenshots)

The pitch shifting itself is Signalsmith Stretch, which is excellent and not my
work — the README credits it plainly. What I built is everything around it, and
two pieces in particular are worth explaining:

**The bass. This was the actual problem.** A phase vocoder mangles low notes —
a 60 Hz bass tone does not have enough periods to survive one. So accompaniment
mode puts a 175 Hz LR-4 crossover in front: above it, the stretcher; below it, a
WSOLA/PSOLA resampler I wrote, which moves all the partials together so the
harmonic structure of the note survives. 481 lines, and it is the part I am
proudest of. You can hear the difference the moment you enable it — the low end
gets noticeably solid.

**Honesty about latency.** I originally wrote "minimal latency" in the README
because it felt right. Then I built a probe that fires an impulse into the
engine's worklet and timestamps when it comes out (npm run latency). The answer
was 100 ms, not minimal. It is in the README now, with the table, and it also
turned out to explain a magic constant elsewhere in the code that I had never
understood. Nobody would have caught that if I had not measured.

Also in there, because they cost me real time to get right and are the kind of
thing you only find out by using the thing:

- The popup tells you when the audio is coming from another tab, and locks the
  controls, because those settings are a different record
- If the engine fails to start it says 未處理 instead of leaving a slider that
  looks live and is not
- The handover between tabs is atomic, with a master gate that fades so the
  outgoing tab never plays with the incoming page's settings
- Chrome only lets you capture a tab the user invoked the extension on, and only
  one tab at a time. The README says so plainly instead of pretending otherwise

Two of the seven ADRs are reversals — features I shipped, used, and then
deleted because real use showed they were wrong. One of them is a dB loudness
meter I built, used for a week, and then removed all the way down to the tests,
because dB readings mean nothing to the people using it.

131 tests, CI, and a runtime verification log recording what was actually run on
a real Chrome rather than what was intended.

Curious about the lowband resampler especially — the period-synchronous timeline
correction in there is the part I went back and forth on the most.
```

**Why this angle:** it leads with a specific technical problem, credits the
library by name in the first paragraph, and offers the measurement story as
evidence of how the project is run. The person reading it learns three real
things in thirty seconds instead of one vague claim.

---

## Twitter / X

Short enough to read, long enough to land. Two variants depending on whether
you want the technical hook or the workflow hook.

**Variant A — technical**

```
Built a Chrome extension for singing along: shift the pitch of any tab in real
time, tempo unchanged.

The interesting part isn't the pitch shifter (that's Signalsmith Stretch, and
it's great). It's that a 60 Hz bass note doesn't survive a phase vocoder — too
few periods. So I put a 175 Hz crossover in front and wrote a WSOLA/PSOLA
resampler for everything below it. You can hear the low end solidify the moment
you turn it on.

Also: I wrote "minimal latency" in the README, then measured it. It was 100 ms.
Fixed the README.

MIT, open source, popup opens to the screenshots.
github.com/arWai-CW/fidelitone
```

**Variant B — workflow**

```
Singing along to a backing track that's in the wrong key, and you don't want to
hunt for another version of the song?

Made a Chrome extension for it. Drag the rail, the pitch moves, tempo doesn't.
Every page remembers its own setting, so switching to the next video applies it
automatically — mid-session you never re-adjust.

It also tells you when the audio is coming from a different tab, and locks the
controls when that's the case, because those settings belong to another record.

MIT + open source: github.com/arWai-CW/fidelitone
```

**On the comparison angle:** if you want to include it, Variant A is the place.
The honest form of the claim is *conditional and self-referential* rather than
about other people:

```
Most browser pitch shifters sound fine at ±2 semitones and fall apart past ±5.
If yours does, check whether the low band is going through a phase vocoder —
that's the usual cause, and it's fixable.
```

That says the same thing ("this is a common failure mode worth checking"),
attributes nothing to yourself that isn't yours, and doesn't put words in
anyone else's mouth. If you want to go further than that, the risk is yours to
take — just know that a reader who disagrees with you will remember it longer
than a reader who agrees.

---

## Repo metadata

Not stored in the repo; set these on the GitHub repo settings page.

**Description** (100 char limit)

```
Real-time pitch shifting for Chrome tabs. Per-page memory, accompaniment mode
for the low end, MIT.
```

**Topics** — pick the ones that describe the tech, not the outcome. Topics are
how a stranger finds you when they are browsing rather than searching.

```
chrome-extension
web-audio
audio-processing
pitch-shifting
dsp
webaudio
audioworklet
manifest-v3
music
karaoke
```

**Website:** leave empty until the store listing is live, then point it there.
