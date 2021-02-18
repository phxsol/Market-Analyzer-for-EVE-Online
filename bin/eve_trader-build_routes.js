const https = require('https');
const agentkeepalive = require('agentkeepalive');
const nano = require('nano')({
    "url": "http://phx:c002n68r7507@localhost:5984",
    "requestDefaults": {
        "agent": new agentkeepalive({
            maxSockets: 50,
            maxKeepAliveRequests: 0,
            maxKeepAliveTime: 30000
        })
    }
});
let eve_names_database, eve_universe_database, eve_nav_database;
let names_manifest = [];
let systems_manifest = [];
let stargates = [];
let systems = [];
let routes = {};
let workbook = [];

// -- MAIN FUNCTIONS ------------------------------------------

const init = async () => {
  eve_nav_database = nano.use('eve_nav_database');
  eve_universe_database = nano.use('eve_universe');

  const stargate_q = {
     selector: {
        type: {
           "$eq": "stargate"
        }
     },
     limit: 100000
  };
  await eve_universe_database.find(stargate_q)
    .then(async (answer) => {
      await answer.docs.map(map_to_manifest, stargates);
    });

  const system_q = {
     selector: {
        type: {
           "$eq": "system"
        }
     },
     limit: 100000
  };
  await eve_universe_database.find(system_q)
    .then(async (answer) => {
      systems_manifest = answer.docs;
      await answer.docs.map(map_to_manifest, systems);

    });

}

const plan_routes = async () => {

  for(i=0; i<systems_manifest.length; i++){
    let start_system = systems_manifest[i];

    console.log(`System: ${start_system.system_id}`);
    for(tier=0;tier<=100;tier++){
      const add_tiers_connections = async () => {
        workbook[tier] = [];
        let tier_manifest = (tier==0) ? start_system.stargates : workbook[tier - 1];
        console.log(`Tier: ${tier} | Destinations: ${tier_manifest.length}`);
        for(i2=0;i2<tier_manifest.length;i2++){
          let stargate_id = tier_manifest[i2].stargate_id;
          console.log(`stargate_id: ${stargate_id}`);
          let destination_system_id = stargates[stargate_id].destination.system_id;
          let destination_stargate_id = stargates[stargate_id].destination.stargate_id;
          workbook[tier].push({stargate_id: destination_stargate_id, system_id: destination_system_id});
        }
      }
      await add_tiers_connections();
    }
    process.exit();
  }
}

// -- SUB-ROUTINES --------------------------------------------

function map_to_names(item){
  this[item.id] = { name: item.doc.name };
}

function map_to_manifest(record){
  this[record._id] = record;
}
function remove_empties(item){
    return(item != null);
}

// -- SCRIPT LOGIC --------------------------------------------

init().then(plan_routes).catch((err) => { console.log(`to err is \n\n  ${err}\n\n ...human.`)});
