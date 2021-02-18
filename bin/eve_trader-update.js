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
let eve_market_logsDB;
let eve_names_database;
let names_manifest = [];
const regions_index_core = [
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

let product_markets = [];

// -- MAIN FUNCTIONS ------------------------------------------

const init = async () => {
  try{
    eve_names_database = nano.use('eve_names');
    await eve_names_database.list({include_docs: true})
      .then(async (data) => {
        await data.rows.map(map_to_names, names_manifest);
    });



    let regions = regions_index;
    return regions;
  } catch(error){
    throw(error);
  }
}

const fetch_current_market = async (regions_index) => {
  try{
    const fetch_regional_market = async (region_id) => {
      try{
        const region_market_page = async (region_id, page) => {
          return new Promise((resolve, reject) => {
            let api_url = "https://esi.evetech.net/latest/markets/" + region_id + "/orders/?datasource=tranquility&order_type=all&page=" + page;
            //console.log(api_url);
            https.get(api_url, (res) => {
              let data = '';
              res.on('data', (chunk) => {data += chunk});
              res.on('error', reject);
              res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode <= 299) {
                  let order_page = JSON.parse(data);
                  order_page.length;
                  regional_orders = regional_orders.concat(order_page);
                  //console.log(`order_page_length: ${order_page.length} | fetched so far: ${regional_orders.length}`);
                  turn_the_page = (order_page.length == 1000);
                  if(turn_the_page){
                    page++;
                    //console.log(`turn_the_page: ${turn_the_page} | Next Page: ${page}`);
                  } else {
                    page = -1;
                    console.log(`${names_manifest[region_id].name} market has been fetched... ${regional_orders.length} orders found.`);
                  }
                  resolve(page);
                } else {
                  reject('Request failed. status: ' + res.statusCode + ', body: ' + data);
                }
              });
            });
          });
        }

        let regional_orders = [];
        let page = 1;
        while(page != -1){
          //console.log(`fetching page ${page} from region_id: ${region_id}`);
          await region_market_page(region_id, page).then((next_page) => {
            //console.log(`fetched page ${page} | next_page: ${next_page}`);
            page = next_page;
          }).catch(_=>{
            page = page;
          });
        }
        await Promise.all(regional_orders.map(async (order) => {
          order.region_id = region_id;
          order.unallocated = (order.volume_remain) ? (order.volume_remain) : 0;
          return order;
        }));
        return regional_orders;
      } catch(err) {
        throw(err);
      }
    }

    const categorize_by_type = async (region_id, regional_orders) => {
      try{
        //console.log(`in categorize: ${regional_orders.length} orders to sort.`);
        let order = regional_orders.pop();
        //console.log(order);
        //throw('a hissy');
        while(typeof order !== 'undefined'){
          let type_id = order.type_id;
          if(!product_markets[type_id]){
            //console.log(`No market for type_id: ${type_id}... adding one now.`)
            product_markets[type_id] = { _id: type_id.toString(), type_id: type_id, demand: [], supply: [] }
          }
          if(product_markets[type_id] == 'undefined') console.log(`product_markets[type_id] is null? ${type_id} | ${product_markets[type_id]}`);
          if(typeof order.is_buy_order !== 'undefined' && order.is_buy_order){
            product_markets[type_id].demand.push(order);
          } else {
            product_markets[type_id].supply.push(order);
          }
          order = regional_orders.pop();
        }
        //console.log(`leaving categorize | regional_orders.length ${regional_orders.length} product_markets.length: ${product_markets.length}`);
        return;
      } catch(err){
        throw(err);
      }
    }

    const sort_market_orders = async () => {
      for(ndx=0;ndx<product_markets.length;ndx++){
        if(product_markets[ndx]){
          await product_markets[ndx].supply.sort(sort_supply_orders_by_price);
          await product_markets[ndx].demand.sort(sort_demand_orders_by_price);
        }
      }
      return;
    }

    let fetch_promises = [];
    for(ndx=0;ndx<regions_index.length;ndx++){
      let region_id = regions_index[ndx];
      let fetch_promise = fetch_regional_market(region_id)
        .then(async (regional_orders) => categorize_by_type(region_id, regional_orders))
        .then(async () => sort_market_orders())
        .catch(async (err) => console.error(err));
      console.log(`promise to fetch: ${region_id}`);
      fetch_promises.push(fetch_promise);
    }
    return Promise.all(fetch_promises);
    /*
    let region_id = regions_index.pop();
    while(typeof region_id !== 'undefined'){
      await fetch_regional_market(region_id)
        .then((regional_orders) => categorize_by_type(region_id, regional_orders))
        .catch((err) => console.error(err))
        .finally(_ => {region_id = regions_index.pop();});
    }*/

  } catch (error) {
    throw(error);
  }
}

const save_product_markets = async _ => {
  try{
    const insert_records = async (product_market) => {
      try{

        return eve_market_logsDB.insert(product_market, function (err, data) {
            if(err) throw(err);
        });
      } catch(error) {
        throw(error);
      }
    }

    const throttled_parallel_insertion = async _ => {
      try{
        let inflight_insertions = new Set();
        let product_market = product_markets.pop();
        /*console.log(product_markets.length);
        for(prop in product_market){
          if(product_markets.hasOwnProperty(prop)){
            console.log(`product_markets.${prop} = ${product_markets[prop]}`);
          }
        }*/
        while(typeof product_market !== 'undefined'){
          /*await insert_records(product_market);
          console.log(`market_inserted: ${product_market.type_id} | ${product_markets.length} remaining`);
          product_market = product_markets.pop();*/
          //Hold the While loop until the next promise resolves.
          if(inflight_insertions.size >= 30){
            console.log(`D-1: inflight_insertions: ${inflight_insertions.size}`);
            await Promise.race(inflight_insertions);
            console.log(`D-2: inflight_insertions: ${inflight_insertions.size}`);
          }

          // Create and add insertion promise to the inflight set
          //console.log(`market_inserted: ${product_market.type_id} | ${product_markets.length} remaining | inflight_insertions: ${inflight_insertions.size}`);
          const insertion = insert_records(product_market);
          inflight_insertions.add(insertion);
          insertion.then(inflight_insertions.delete(insertion));
          product_market = product_markets.pop();
        }
        return;
      } catch(error) {
        console.error(error);
      }
    }

    eve_market_logsDB = nano.use('eve_market_logs');
    await eve_market_logsDB.list({ revs_info: true })
      .then(async (data) => {
        await data.rows.map(map_to_product_markets, product_markets);
    });
    console.log(`removing empties | current product_markets.length: ${product_markets.length}`);
    product_markets = await product_markets.filter(remove_empties);
    console.log(`saving markets now | product_markets.length: ${product_markets.length}`);
    await throttled_parallel_insertion();

    return;
  } catch(error) {
    throw(error);
  }
}

// -- SUB-ROUTINES --------------------------------------------

function remove_empties(item){
    return(item != null);
}

function map_to_names(item){
  this[item.id] = { name: item.doc.name };
}

function map_to_product_markets(item){
  if(this[item.id]) this[item.id]._rev = item.value.rev.toString();
}


function sort_supply_orders_by_price(a, b){
  return (a.price<b.price) ? -1 : (a.price>b.price) ? 1 : 0;
}

function sort_demand_orders_by_price(a, b){
  return (a.price<b.price) ? 1 : (a.price>b.price) ? -1 : 0;
}

// -- SCRIPT LOGIC --------------------------------------------

init()
  .then(fetch_current_market)
  .then(save_product_markets)
  .catch((err) => { console.log(`to err is \n\n  ${err}\n\n ...human.`)});
