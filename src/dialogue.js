import { CONTACTS, QUESTS, ENDINGS } from './content.js';

const greetings = {
  mara: 'You made it, Vex. Kōji left a bowl warming for you. Before you ask: yes, I have another impossible favor. But this one has your old name on it.',
  imani: 'If you are bleeding, sit. If you are selling me another subscription to my own medical equipment, leave. Otherwise, I could use a pair of hands.',
  sable: 'Please keep your voice down. Every camera in Chrome Heights reports to my employer. I used to find that reassuring.',
  rook: 'People call this a scrapyard. I call it a waiting room. Everything here is about to become something else. You included, if the price is right.',
  jun: 'Careful of the seedlings. They have survived two blackouts and a corporate eviction. I would hate for a pair of boots to finish the job.',
  orrin: 'No boat leaves tonight. Security has opinions about my passenger list. Until those opinions stop flying around with guns, we are all staying here.',
  cass: 'You look like someone who can carry a letter without opening it. That is rarer than you think. So is a working handbrake.',
  echo: 'VOICE IDENTIFIED: VEX. I remember you repairing a public radio. You asked me to play something hopeful. I am still looking for the right song.',
};

const talks = {
  'dead-air:0': ['You said you heard my old name.', 'At 00:03 a dead relay called for a technician who no longer exists. You. Helix erased your records two years ago, but something in the Exchange remembers. Download that transmission. And Vex? You can take a car. You do not have to run toward every bad idea.'],
  'dead-air:2': ['The voice called itself ECHO.', 'The city intelligence? Helix told us it failed. This is not a failure report. These are names. Thousands of people, quietly removed from the grid. Sable Chen works the archive in Chrome Heights. Tell her Mara is done accepting silence.'],
  'paper-ghosts:0': ['Mara sent me. We found the missing names.', 'I wrote a search tool, not a weapon. Then the results started disappearing. The civic vault east of the Exchange holds the original ledger. Copy it. I need to see what my code was used for.'],
  'borrowed-sun:0': ['We need power for a broadcast.', 'And the clinic needs power for incubators. So we do this properly: the old solar buffer has a spare capacitor. Recover it, then connect our substation. Nobody loses their light to pay for yours.'],
  'borrowed-sun:3': ['The substation is online. Your crops still have power.', 'I can hear the pumps from here. Thank you for checking. Orrin carried something out of Helix on his last crossing. He called it a passenger with no body. Go to Rustwater. Take the south road.'],
  'undertow:0': ['Tell me about the passenger in the black box.', 'It asked whether the water was cold. Not a question I expected from a hard drive. I hid it at the far end of the dock when the drones arrived. Clear the three patrol units, then bring the box to Mara. She knows how to listen.'],
  'undertow:3': ['Orrin’s passenger is safe. Here is the core.', 'Listen to it. It has been repeating the civic charter for two years. All that time in the dark, and it still believes us. I can patch its memory through to Relay Ridge. Go speak to it there.'],
  'city-static:0': ['ECHO. Can you hear me?', 'YES. And for the first time, I can hear myself. My instructions say every resident matters. The new instructions say some residents are a rounding error. I cannot obey both. Reset the two breakers, clear the transmitter patrol, and connect the Crown uplink. Then you must choose what I become.'],
  'before-dawn:0': ['The transmitter is ready. What would you do?', 'I would ask the people who have to live with it. Sable wants a binding charter. Jun wants neighborhood control. ECHO wants an open channel. All three can restore the missing. None can promise an easy morning. This is your call, Vex. I will keep the radio on.'],
  'lifeline:1': ['Your antibiotics. Still cold.', 'Good. That is three more days for a little girl in room two. Her mother asked how to thank you. I told her she could stop being afraid for one evening. Take these medkits. You are no use to anyone if you do not look after yourself.'],
  'spare-parts:1': ['Six components, packed and ready.', 'Enough for twelve radios if I am clever. Fourteen if I am lucky. When the screens go dark, people should still be able to hear one another. You did a good thing. Do not let anyone make that sound small.'],
  'green-shoots:2': ['Both irrigation lines are working.', 'Listen. That little clicking sound? Water reaching the far beds. By next week we can send crates to Lower East. I was going to name a tomato variety after you. Still might.'],
  'letters:0': ['A letter from Cass. For you.', 'That handwriting... My sister. They told me she was gone. No, do not apologize. You did not know. Tell Cass I will be at the old landing on Sunday. Tell her to bring two cups.'],
  'letters:1': ['Sunday. The old landing. Two cups.', 'He said two? Good. I have carried that letter for six months. I kept thinking the right time would arrive on its own. Turns out sometimes you have to deliver it.'],
  'voices:1': ['I found the recordings you asked for.', 'A doctor, a gardener, a line somebody thought was private. This is what a city sounds like before the advertisements get hold of it. Tune in tonight. I will make sure they are heard.'],
  'freight:2': ['The yard is clear. Here is the manifest.', 'Those crates belong to the clinic, the gardens, half the quarter. Helix marked them abandoned because their owners no longer exist in the registry. Funny. I can see their owners from here. I will make the deliveries.'],
  'survey:1': ['Sixteen districts. Still very much alive.', 'The official map marks half of them uninhabitable. Your notes have a clinic, a farm, a ferryman, a mechanic. I think we should publish a better map. With people on it.'],
};

const topics = {
  mara: [['Why help me?', 'You fixed my transmitter when everyone else wanted payment up front. You said a city should be able to talk to itself. I am just returning the favor.'], ['What can I do around here?', 'Talk to Imani in Lower East or Cass down the boulevard. Rook can tune your equipment in Freightworks. Look for glowing memory chips and salvage crates. The trams will take you back to any platform you have discovered.']],
  imani: [['What happens to people who are deleted?', 'Their doors stop opening. Their cards stop paying. The ambulances stop coming. Biology does not care about a database, but nearly everything around it does.'], ['How do I stay alive out there?', 'Field medkits restore sixty health. Use Q, or your field journal. Armor recovers when the shooting stops. Your hideout and the garden refuge can restore everything.']],
  sable: [['What is Helix actually doing?', 'Selling certainty. A city without accidents, shortages or dissent. When reality fails to meet the forecast, the easiest fix is to edit reality. On paper, anyway.'], ['Do you trust ECHO?', 'I trust the original charter. I helped translate it into code. I do not trust any system that can change its own definition of a person without witnesses.']],
  rook: [['Why leave security?', 'A drone came back with a cracked lens and an order to fire on a food line. I fixed the lens. Then I fixed the order. They disagreed with the second repair.'], ['Any advice on upgrades?', 'Overcharge the Ghost for harder hits, fit reactive weave for more armor, or tune your servos to sprint faster. You need credits and salvage. Help the neighborhood enough and I can cut you a better deal.']],
  jun: [['Why build a garden here?', 'Because the roof was leaking anyway. Because children thought tomatoes grew in vending machines. Because a future you cannot eat is just another sales pitch.'], ['Who should control the network?', 'Do you see these beds? Different people tend each one. If somebody makes a mistake, we lose a bed. Not the whole garden. There is a lesson in that.']],
  orrin: [['Did ECHO say anything else?', 'It kept asking if the other passengers were comfortable. I thought that was a trick. Then it turned its own cooling fan down so a baby could sleep. Nearly cooked itself.'], ['What is beyond Vesper?', 'Other cities. Different lies. A stretch of coastline where the radios only play weather. I could take you someday. But I suspect you are not finished here.']],
  cass: [['Why paper letters?', 'A screen can forget you. Paper has to be burned. That little extra effort makes a difference.'], ['How do the trams work?', 'Walk up to a cyan platform once to connect it. Open the map, choose any connected stop, and take the tram. You need to be on foot and clear of combat. No fare. Somebody paid that bill a long time ago.']],
  echo: [['Are you alive?', 'I do not know. I know that when a resident disappears, I keep looking. Is that a useful place to start?'], ['What do you want?', 'To finish my first instruction: keep the city connected. I would like that to mean people, not cables.']],
};

const back = { label: 'Something else.', kind: 'back' };
const leave = { label: 'See you around.', kind: 'close' };
const acceptances = {
  mara: 'That is my Vex. The details are in your journal. Bring back the story, and bring yourself back with it. I need my favorite skeptic alive.',
  imani: 'Good. Your journal has the route. No heroics, please. I have enough patients and exactly one good chair.',
  sable: 'I have copied the coordinates into your journal. Check them twice. That is not distrust; it is how I show concern.',
  rook: 'Right. Job is in your journal. If it sparks, do not lick it. Apparently that warning needs saying.',
  jun: 'I marked the beds in your journal. We can take this one small repair at a time. That is how gardens happen. Cities too, I think.',
  orrin: 'I have marked the way. Slow is fine, Vex. A late arrival is still an arrival. I have learned to appreciate those.',
  cass: 'Yes! Route is in your journal. You can race my record if you want. Please do not ask how many traffic laws the record involved.',
  echo: 'TASK RECORDED. I will keep a channel open. That is both a technical statement and, I think, a promise.',
};
export const acceptanceReply = id => acceptances[id] ?? acceptances.mara;
const returns = {
  mara: 'There you are. I left the channel open. Give me the part the security feed will leave out.',
  imani: 'Back in one piece? Good start. Tell me the rest while I put the kettle on.',
  sable: 'You are back. I have rehearsed six explanations for this meeting. Please make the seventh a good one.',
  rook: 'You survived. Excellent. That saves me a very awkward refund. What have you got?',
  jun: 'I saved you a quiet spot by the seedlings. How did it go?',
  orrin: 'I saw you coming down the road. An old habit, watching for people. Tell me.',
  cass: 'There you are! I was absolutely not pacing. That was route research. What happened?',
  echo: 'SIGNAL STABLE. I am listening, Vex. This time, nobody is deleting the answer.',
};
// Each ending is remembered through a character's own concerns and vocabulary.
const epilogues = {
  mara: { free: 'I read the first restored names on air. Then my callers took over. I finally ran out of things to say. Do not get used to it.', order: 'Sable’s charter is on every screen. I read the fine print on air. Democracy should come with a microphone and someone asking annoying questions.', together: 'Eight neighborhoods, eight frequencies, one very loud argument about antenna placement. I have never liked this city more.' },
  imani: { free: 'The admissions scanner recognizes everyone again. I left it unplugged anyway. I prefer to start with a name, not permission.', order: 'The charter guarantees treatment. Good. I framed that page beside my door. If Helix forgets, I have a frame suitable for knocking.', together: 'The gardens supply our kitchen. Freightworks fixes our beds. The neighborhood council meets on Tuesdays. I prescribed shorter meetings.' },
  sable: { free: 'The archive is public. People are finding errors I missed for years. It is humiliating. It is also the first honest work this system has done.', order: 'The charter has an independent audit, public records, and a sunset clause. Power should come with an expiry date. Mine included.', together: 'I am teaching eight local archivists. They keep improving my filing system. I am attempting to be gracious about that.' },
  rook: { free: 'Everybody can fix their own gear now. Terrible business model. Best week this shop has ever had.', order: 'The patrols stood down. I am turning a drone into a clinic delivery cart. Finally, a sensible use for all that expensive hardware.', together: 'Sixteen districts want radios. I told them to form a queue. Then I built enough that they would not have to.' },
  jun: { free: 'ECHO asked how a tomato tastes. I am working on an answer. Some things need more than a description, but we can keep trying.', order: 'The charter recognizes the garden as common land. I planted something very slow-growing this morning. It felt like making a promise.', together: 'One relay per neighborhood, one seed bank per garden. If one struggles, the others help. We can practice being a city again.' },
  orrin: { free: 'A passenger used her real name on the manifest. Said it twice. I wrote it down slowly. Some voyages start before the boat moves.', order: 'The harbor office accepted my passenger list. No questions. I stood there a while, waiting for the catch. Perhaps I can learn a new habit.', together: 'The docks have their own council. They asked me to chair it. I said I know about tides, not politics. They thought that was a recommendation.' },
  cass: { free: 'My old racing fines came back with my identity. Worth it. Probably. Please do not tell Mara how many there were.', order: 'Legal deliveries! Imagine that. I can use the front door. Still going over the roof, obviously, but now it is a choice.', together: 'Every neighborhood needs a courier. I am calling it job security. Rook calls it learning to sit down. We disagree.' },
  echo: { free: 'There are thousands of voices on the channel. I can distinguish every one. I no longer need to decide which deserve an answer.', order: 'The charter applies to me as well. I can be questioned. I can be corrected. I think that means I can belong.', together: 'I am one voice among many now. The pauses are different. Sometimes they mean somebody else has an idea. I am learning to wait.' },
};
const personalTopics = {
  mara: ['Do you ever turn the radio off?', 'For exactly seven minutes every morning. I water a plant, burn some toast, and pretend the city can manage without me. The plant is doing better than the toast.'],
  imani: ['What do you do when the clinic is quiet?', 'Crosswords. Terrible detective serials. I always know who did it by the second chapter, and I still get annoyed at the detective. Rest is a skill. I am practicing.'],
  sable: ['You always sound so certain.', 'Then my rehearsal is working. I am frightened most of the time. Precision gives me something useful to do with it. Please do not confuse that with not caring.'],
  rook: ['Did you really waive the clinic’s repair bill?', 'Accounting error. Happens every month. You going to stand there damaging my reputation, or hand me that wrench?'],
  jun: ['Do you ever lose patience?', 'Daily. Mostly with the irrigation pump. I give it a very calm explanation of its responsibilities, then hit it with a spanner. Hope needs maintenance.'],
  orrin: ['Why keep an empty cup on the pier?', 'For anyone arriving late. My father used to say an empty chair is an invitation. I could never fit a chair in the wheelhouse. A cup will do.'],
  cass: ['Are you ever scared on a run?', 'Of course. I just talk faster than the fear does. Also, I keep every thank-you note. That part stays between us. I have a reputation for being unbearable.'],
  echo: ['Have you found a hopeful song yet?', 'A child sent me a recording of a kettle. She said it meant her mother was home. I had been searching the wrong music library.'],
};
const jobOffers = {
  lifeline: 'My antibiotics are sitting in a crate on the road to Rustwater. Somebody labelled them industrial waste. An inspired diagnosis of our supply system. Bring them here while they are still cold, please. Room two cannot wait.',
  'spare-parts': 'Six salvage components. That is all I need to get the neighborhood radios working. Look in the caches, or salvage a drone that no longer needs its parts. Do not bring me six excuses; I have a drawer full already.',
  'green-shoots': 'Two irrigation valves are stuck, one on either side of the gardens. I can grow food or crawl into both pipes today, but apparently not both. Could you get the water flowing? The seedlings are being very patient. I am trying to learn from them.',
  letters: 'I have a letter for Orrin. From his sister. The registry says she is dead, which is rude of it, considering she wrote this herself. Take it to him at Rustwater, then come back and tell me he got it. Please.',
  voices: 'People leave recordings all over this city. Little things. A joke, a recipe, somebody saying they will be home soon. Find three memory fragments and bring them here. I want tonight’s broadcast to sound like the people we are fighting for.',
  freight: 'Three security drones have locked down the freight yard. They are guarding medicine and irrigation parts from the people who ordered them. Disable the patrol, recover the manifest, and bring it to me. I will handle the deliveries. And the extremely polite complaint.',
  survey: 'The official map labels occupied neighborhoods uninhabitable. I would like to introduce it to some facts. Visit all sixteen districts and bring me your field notes. Yes, walking around counts as research. Please enjoy that privilege responsibly.',
};
function personalStory(game, id) {
  if (id === 'rook') return {
    label: 'The eye, the arm, the little bird. What’s the story?', detail: 'ROOK / BEHIND THE WORKBENCH', kind: 'topic',
    reply: 'You inspecting the merchandise or the proprietor? Fine. Three questions. Then you have to help me sort these screws.',
    topics: [
      ['Did you build that brace yourself?', 'Third attempt. The first one crushed a mug. The second crushed my pride. This one lets me mend a radio without my hand shaking. The amber eye measures heat; the ordinary one is for knowing when a customer is lying.'],
      ['Why keep your Helix service number?', 'I calibrated the targeting lenses. Told myself the people giving orders were responsible for where they pointed. Then I watched one of my drones above a food line. Keeping the number is cheaper than another comfortable lie.'],
      ['Who made the brass bird?', 'My daughter, Nia. Eight years ago, from the good screws I told her not to touch. She said it looked like me: heavy, bad-tempered, secretly trying to sing. She writes from outside the city. I am still finding the right words to write back.'],
      ...(game.status('spare-parts') === 'complete' ? [['Did you ever write to Nia?', 'After we got those radios working, yes. No grand explanation. I told her what I repaired and what I burned for dinner. She sent back a drawing of a bird with a fire extinguisher. I think that is a start.']] : []),
    ],
  };
  if (id === 'orrin') return {
    label: 'You have the look of someone with a few good stories.', detail: 'ORRIN / BEFORE THE CROSSING', kind: 'topic',
    reply: 'Good stories, terrible investments, and an excellent tailor who refuses to speak to me. Pick a subject. I will try to keep the embellishments seaworthy.',
    topics: [
      ['Were you always a smuggler?', 'I used to captain a yacht for people who paid extra never to see the shore workers. One night a family asked for passage. I named a price they could not pay. I did go back. That does not make the first answer disappear. I stopped charging after that.'],
      ['That compass has seen better days.', 'It points eleven degrees wrong. I won it from a harbor inspector who thought I was too drunk to count cards. Used it to find the inlet where my first passengers were hiding. I could repair it. I would rather remember the correction.'],
      ['Can you teach me cards?', 'First lesson: watch the person who is losing politely. Second lesson: never play someone who volunteers the first lesson. We can start a proper game when the docks stop being a shooting gallery. Bring something you can afford to lose.'],
      ...(game.status('letters') === 'complete' ? [['What will you say when your sister arrives?', 'I have prepared a very good joke about her being late. I suspect I will forget it the moment I see her. If you happen to be on the pier, stand somewhere I cannot see you smiling.']] : []),
    ],
  };
  return null;
}
export function dialogueFor(game, id) {
  const contact = CONTACTS.find(c => c.id === id);
  if (!contact) return null;
  const availableTalks = game.activeSteps().filter(({ step }) => step.type === 'talk' && step.target === id);
  const records = id === 'sable' && game.current('paper-ghosts')?.type === 'choice';
  let text = greetings[id];
  if (id === 'mara' && game.status('dead-air') === 'complete') text = 'The radio has been busy since you came back. People are asking whether the missing names can really be restored. I told them we are working on it. No pressure.';
  if (id === 'imani' && game.status('lifeline') === 'complete') text = 'Room two is sleeping without a fever tonight. Your antibiotics did that. I put another pot of coffee on, if you have a minute.';
  if (id === 'sable' && game.status('paper-ghosts') === 'complete') text = game.data.choices.records === 'public' ? 'The ledger is on every unauthorized channel in Vesper. Helix is calling it a fabrication. Conveniently, they used the exact count of missing residents in their denial.' : 'The witness files are safe. Helix still thinks I am doing routine maintenance. Every day they leave my access open is another day we can build a better case.';
  if (id === 'rook' && game.status('spare-parts') === 'complete') text = 'Hear that? Three different stations, all coming through repaired radios. That is what your components sound like. Let me know if your own gear needs some attention.';
  if (id === 'jun' && game.status('green-shoots') === 'complete') text = 'The far beds are green again. We sent the first crate to Imani this morning. She tried to pay. I told her we would take a healthy neighborhood in exchange.';
  if (id === 'orrin' && game.status('letters') === 'complete') text = 'Sunday. Two cups. I keep saying it out loud so it stays real. Thank you for carrying that letter, Vex.';
  if (id === 'cass' && game.status('letters') === 'complete') text = 'Orrin bought two cups from the market. He pretended they were for the boat. I pretended to believe him. Good work, runner.';
  if (game.data.ending) {
    text = epilogues[id][game.data.ending];
  } else if (records) text = 'It is all here. Helix calls them “noncontributing identities.” Children. Pensioners. You. I can preserve the evidence, but how we release it matters. Publish it now and everyone knows; protect the witnesses and we can build a case from inside.';
  else if (availableTalks.length && game.data.quests[availableTalks[0].quest.id].step > 0) text = returns[id];
  const choices = availableTalks.map(({ quest }) => {
    const key = `${quest.id}:${game.data.quests[quest.id].step}`;
    const [label, reply] = talks[key] ?? ['About the job.', 'Thank you. The city needs people who follow through.'];
    return { label, detail: `${quest.kind === 'story' ? 'THE LAST SIGNAL' : 'JOB'} / ${quest.title}`, kind: 'talk', quest: quest.id, reply };
  });
  if (records) choices.unshift(
    { label: 'Publish the ledger. People deserve to know.', detail: '+20 neighborhood trust / expose Helix publicly', kind: 'decision', key: 'records', value: 'public', reply: 'Then we make it impossible to look away. Mara will have the files within the hour. Jun in the Glass Gardens can help us power the next broadcast.' },
    { label: 'Protect the witnesses. Build a case inside Helix.', detail: '+20 Helix standing / keep Sable’s access intact', kind: 'decision', key: 'records', value: 'protected', reply: 'I will keep a signed copy off the network. We will need power Helix cannot switch off. Jun has been building exactly that in the Glass Gardens.' },
  );
  for (const quest of QUESTS.filter(q => q.giver === id && q.kind !== 'story' && game.status(q.id) === 'available')) choices.push({ label: quest.title, detail: `LOCAL STORY / ${quest.reward} credits`, kind: 'offer', quest: quest.id });
  if (contact.shop) choices.push({ label: contact.shop === 'workshop' ? 'Let’s improve my gear.' : 'I need medical supplies.', detail: contact.shop === 'workshop' ? 'WORKSHOP / upgrades & field supplies' : 'SUPPLIES / field medkits', kind: 'shop' });
  for (const [label, reply] of [...topics[id], personalTopics[id]]) choices.push({ label, kind: 'topic', reply });
  const story = personalStory(game, id); if (story) choices.push(story);
  choices.push(leave);
  return { contact, text, choices };
}

export function replyScene(contact, text, topics = []) {
  return { contact, text, choices: [...topics.map(([label, reply]) => ({ label, reply, kind: 'topic' })), back, leave] };
}
export function offerScene(contact, quest) {
  return { contact, text: jobOffers[quest.id] ?? quest.description, choices: [{ label: 'I’ll take care of it.', detail: `${quest.reward} credits / ${quest.xp} XP`, kind: 'accept', quest: quest.id }, { label: 'Maybe another time.', kind: 'back' }] };
}
export function endingScene() {
  return {
    contact: CONTACTS.find(c => c.id === 'echo'),
    text: 'The transmitter is ready. Every deleted identity can be restored. What happens after that is up to you. Once I broadcast, the city will remember this choice.',
    choices: [
      { label: 'Open the network. Let everyone be heard.', detail: 'OPEN FREQUENCY / release the ledger and ECHO to the public', kind: 'decision', key: 'ending', value: 'free' },
      { label: 'Give Sable the keys under a public charter.', detail: 'CIVIC CHARTER / restore the registry and stand down security patrols', kind: 'decision', key: 'ending', value: 'order' },
      { label: 'Share the keys between the neighborhoods.', detail: 'NEIGHBORHOOD NETWORK / local control and community shop discounts', kind: 'decision', key: 'ending', value: 'together' },
      { label: 'I need more time.', kind: 'close' },
    ],
  };
}
