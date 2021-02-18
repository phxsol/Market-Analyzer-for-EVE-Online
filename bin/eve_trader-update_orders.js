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
let eve_names_database, eve_market_database;
const regions_index_safezones = [
  10000002, // The Forge
  10000016, // Lonetrek
  10000020, // Tash-Murkon
  10000028, // Molden Heath
  10000030, // Heimatar
  10000032, // Sinq Laison
  10000033, // The Citadel
  10000036, // Devoid
  10000037, // Everyshore
  10000038, // The Bleak Lands
  10000042, // Metropolis
  10000043, // Domain
  10000044, // Solitude
  10000048, // Placid
  10000052, // Kador
  10000064, // Essence
  10000065, // Kor-Azor
  10000067, // Genesis
  10000068,  // Verge Vendor
  10000069 // Black Rise
];
const regions_index_test = [
  10000068  // Verge Vendor
];
const regions_index = [
  10000001,
  10000002,
  10000003,
  10000004,
  10000005,
  10000006,
  10000007,
  10000008,
  10000009,
  10000010,
  10000011,
  10000012,
  10000013,
  10000014,
  10000015,
  10000016,
  10000017,
  10000018,
  10000019,
  10000020,
  10000021,
  10000022,
  10000023,
  10000025,
  10000027,
  10000028,
  10000029,
  10000030,
  10000031,
  10000032,
  10000033,
  10000034,
  10000035,
  10000036,
  10000037,
  10000038,
  10000039,
  10000040,
  10000041,
  10000042,
  10000043,
  10000044,
  10000045,
  10000046,
  10000047,
  10000048,
  10000049,
  10000050,
  10000051,
  10000052,
  10000053,
  10000054,
  10000055,
  10000056,
  10000057,
  10000058,
  10000059,
  10000060,
  10000061,
  10000062,
  10000063,
  10000064,
  10000065,
  10000066,
  10000067,
  10000068,
  10000069,
  11000001,
  11000002,
  11000003,
  11000004,
  11000005,
  11000006,
  11000007,
  11000008,
  11000009,
  11000010,
  11000011,
  11000012,
  11000013,
  11000014,
  11000015,
  11000016,
  11000017,
  11000018,
  11000019,
  11000020,
  11000021,
  11000022,
  11000023,
  11000024,
  11000025,
  11000026,
  11000027,
  11000028,
  11000029,
  11000030,
  11000031,
  11000032,
  11000033,
  12000001,
  12000002,
  12000003,
  12000004,
  12000005,
  13000001
];

let names_manifest = [];
let market_orders = [];
let timestamp = Date.now();

// -- MAIN FUNCTIONS ------------------------------------------

const init = async () => {
  try{
    eve_market_database = nano.use('eve_market');
    eve_names_database = nano.use('eve_names');
    await eve_names_database.list({include_docs: true})
      .then(async (data) => {
        await data.rows.map(map_to_names, names_manifest);
    });
  } catch(error){
    throw(error);
  }
}

const fetch_region_markets = async (region_id) => {
  try{
    const fetch_region_market = async (region_id, page) => {
      return new Promise(async (resolve, reject) => {
        let api_url = "https://esi.evetech.net/latest/markets/" + region_id + "/orders/?datasource=tranquility&order_type=all&page=" + page;
        https.get(api_url, (res) => {
          let data = '';
          res.on('data', (chunk) => {data += chunk});
          res.on('error', reject);
          res.on('end', async () => {
            if (res.statusCode >= 200 && res.statusCode <= 299) {
              let parsed_orders = JSON.parse(data);
              let market_order_page = parsed_orders.map(map_to_orders, region_id);
              await save_market_orders(market_order_page);
              turn_the_page = (parsed_orders.length == 1000);
              if(turn_the_page){
                page++;
                //console.log(`turn_the_page: ${turn_the_page} | Next Page: ${page}`);
              } else {
                let order_count = (page*1000 + parsed_orders.length);
                console.log(`${names_manifest[region_id].name} market has been fetched... ${order_count} orders found.`);
                page = -1;
              }
              resolve(page);
            } else {
              reject('Request failed. status: ' + res.statusCode + ', body: ' + data);
            }
          });
        });
      });
    }
    let promised_fetches = [];
    console.log(`fetching: ${region_id}...`);
    let page = 1;
    while(page != -1){
      console.log(`page: ${page}`);
      await fetch_region_market(region_id, page)
        .then((next_page) => {
          page = next_page;})
        .catch(async (err) => {
          page = page;
          console.error(err);
        });
      /*if(promised_fetches.length >= 5){
        await Promise.all(promised_fetches);
      }*/
    }
    return;
  } catch (error) {
    throw(error);
  }
}

const save_market_orders = async (market_order_page) => {
  try{
    await eve_market_database.bulk({docs:market_order_page});
    return;
  } catch(error) {
    throw(error);
  }
}

// -- SUB-ROUTINES --------------------------------------------

function map_to_names(item){
  this[item.id] = { name: item.doc.name };
}

function map_to_orders(order){
  order.region_id = this;
  order.unallocated = (order.volume_remain) ? (order.volume_remain) : 0;
  order._id = `${order.order_id.toString()}@${timestamp.toString()}`;
  order.type = "incoming_order";
  //console.log(`Order id:(${order.order_id}) for Product "${order.type_id}" has been fetched.`);
  return order;
}

function map_to_existing_records(order){
  console.log(order);
  if(this[order.id]) this[order.id]._rev = order.key.toString();
}

function remove_empties(item){
    return(item != null);
}

// -- SCRIPT LOGIC --------------------------------------------

init()
  .then(async _ => {
    for(ndx_a=0;ndx_a<regions_index.length;ndx_a++){
        let region_id = regions_index[ndx_a];
        await fetch_region_markets(region_id).catch((err) => { console.log(`error occurred while fetching for ${names_manifest[region_id].name}`)});
        await save_market_orders().catch((err) => { console.log(`error occurred while saving for ${names_manifest[region_id].name}`)});
        market_orders = [];
    }
  }).catch((err) => { console.log(`to err is \n\n  ${err}\n\n ...human.`)});
