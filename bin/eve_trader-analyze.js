const fs = require('fs');
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
const eve_market_database = nano.use('eve_market_logs');
const eve_meta_database = nano.use('eve_meta');
const eve_universe_database = nano.use('eve_universe');
const eve_names_database = nano.use('eve_names');

const limits = {
  profit_margin: 0.5,
  low_sec_margin: 1.0,
  excise_charge: 250000, // Charge to make both stops (source, destination)... conditionally modified later on.
  per_trip_profit: 15000000,
  max_hold_size: 35000, // Ships under this limit pack down to ship at 50,000 m3
  max_item_volume: 1000000,
  no_null_space: true // Removes Null Sec transactions from the analysis
}
let market_manifest = [];
let item_meta_manifest = [];
let systems_data = [];
let names_manifest = [];
let trading_manifest = [];
let demand_manifest = [];

// ---- MAIN FUNCTIONS -------------------------------------------------------//

async function init(){
  let eve_meta_promise = await eve_market_database.list({include_docs: true})
  .then(async (markets) => {

    await markets.rows.map(map_to_market_manifest, market_manifest);

    while(item_meta_manifest.length == 0){
      await eve_meta_database.list({ include_docs: true })
      .then(async (data) => {
          if(data){
            await data.rows.map(map_to_item_meta, item_meta_manifest);
          }
          else{
            console.error("item_meta_manifest failed to populate... retrying.");
          }
      });
    }

    while(systems_data.length == 0){
      await eve_universe_database.view('systems','list')
      .then(async (data) => {
          if(data){
            await data.rows.map(map_to_systems, systems_data);
          }
          else{
            console.error("systems_data failed to populate... retrying.");
          }
      });
    }

    /*let market_index = markets.rows.map(extract_type_ids);
    await eve_market_database.fetch({ keys: market_index }).then(async (data) => {
      await data.rows.map(map_to_market_manifest, market_manifest);
    });*/

    await eve_names_database.list({include_docs: true}).then(async (data) => {
      await data.rows.map(map_to_names, names_manifest);
    });
  });
  await eve_meta_promise;
}

async function analyze_market_data(){
  for(ndx_a=0;ndx_a<market_manifest.length;ndx_a++){
    try{
      while(!market_manifest[ndx_a])ndx_a++;
      if(ndx_a>=market_manifest.length) break;
      let item_market = market_manifest[ndx_a];
      // Supply & Demand Check
      //console.log(ndx_a);
      //console.log(market_manifest[ndx_a]);
      let supply = item_market.supply.length;
      let demand = item_market.demand.length;
      //console.log(`Analyzing market for [ ${item_market.type_id} ] | Supply: ${supply} vs Demand: ${demand}`);
      if(supply > 0 && demand > 0){
        let highest_bid = await item_market.demand.reduce(return_highest_bid, Number.MIN_VALUE);
        let lowest_price = await item_market.supply.reduce(return_lowest_price, Number.MAX_VALUE);
        let profit = highest_bid-lowest_price;
        // Profitable Items Only
        //console.log(`best profit: ${profit}`);
        if(profit>0){
          //console.log(`item_market[${item_market.type_id}]`);
          let type_id = item_market.type_id;
          if(!item_meta_manifest[type_id]) await replace_missing_type_data(type_id);
          let name = item_meta_manifest[type_id].name.en;
          let basePrice = item_meta_manifest[type_id].basePrice;
          let profit_base = basePrice-lowest_price;
          let volume = item_meta_manifest[type_id].volume;
          let profit_margin = profit/lowest_price;
          //console.log(`item_meta_manifest[type_id][${item_market.type_id}]= ${item_meta_manifest[item_market.type_id].name.en}`);
          // Making 50% is a good base to start with
          //console.log(`margin: ${percentageFormat(profit_margin)}`);
          if(profit_margin>=limits.profit_margin && volume <= limits.max_item_volume){
            let transactions = [];
            let transaction_log = [];
            let show_logs = false;
            transaction_log.push('');

            // Only work with orders with potential for profit.
            let profitable_supply = await item_market.supply.filter(filter_profitable_supplies, highest_bid);
            //console.log(`Supply: `);
            //console.log(item_market.supply);
            let profitable_demands = await item_market.demand.filter(filter_profitable_demands, lowest_price);
            //console.log(`Demand: `);
            //console.log(item_market.demand);
            // sort to place best orders at the top... to be shifted off.
            await profitable_supply.sort(sort_supply_orders_by_price);
            await profitable_demands.sort(sort_demand_orders_by_price);
            transaction_log.push("|---------------------------------------------------------------------------------------|");
            transaction_log.push(`| [ ${type_id} ]\t ${name} `);
            transaction_log.push("|---------------------------------------------------------------------------------------|");
            transaction_log.push(`| analyzing ${profitable_supply.length} supply & ${profitable_demands.length} demand orders`)
            transaction_log.push(`| Bid: ${currencyFormat(highest_bid)} - Price: ${currencyFormat(lowest_price)} `);
            transaction_log.push(`| Highest Profit Margin(%): ${percentageFormat(profit_margin)} | Volume: ${volumetricFormat(volume)}`);
            transaction_log.push("|---------------------------------------------------------------------------------------|");


            let active_supply_order = profitable_supply.shift();
            while(typeof active_supply_order !== 'undefined'){
              //console.log(profitable_demands);
              /*for(reset_ndx=0; reset_ndx<profitable_demands.length;reset_ndx++){
                //console.log(`resetting demand allocations for ${profitable_demands[reset_ndx].order_id}`);
                profitable_demands[reset_ndx].unallocated = profitable_demands[reset_ndx].volume_remain;
              }
              */
              //console.log('|---------------------------------------------------------------------------------------|');
              //console.log()
              //console.log(`analyzing orders for ${name}`);
              //console.log(`-- [supply] region_id: ${active_supply_order.region_id}  |  system_id: ${active_supply_order.system_id}`);
              //console.log(`\t${active_supply_order.unallocated} @ ${currencyFormat(active_supply_order.price)}`);
              if(systems_data[active_supply_order.system_id].security_status <= 0 && limits.null_space_ok){}
              else{
                for(adndx=0;adndx<profitable_demands.length;adndx++) {
                  let active_demand_order = profitable_demands[adndx];
                  // Scratch pad for transaction values
                  let quantity = Math.min(active_supply_order.unallocated,active_demand_order.unallocated);
                  let profit_each = active_demand_order.price - active_supply_order.price;
                  let profit_margin = profit_each / active_supply_order.price;
                  let profit_total = quantity * profit_each;
                  let profit_per_m3 = profit_each/volume;
                  let investment = quantity * active_supply_order.price;
                  let total_m3 = quantity * volume;
                  let round_trips = Math.ceil(total_m3 / limits.max_hold_size);
                  let quantity_per_trip = Math.min((limits.max_hold_size / volume),quantity);
                  let investment_per_trip = active_supply_order.price * quantity_per_trip;
                  let been_at_source = (active_supply_order.volume_remain != active_supply_order.unallocated) ? 1 : 0;
                  let been_at_destination = (active_demand_order.volume_remain != active_demand_order.unallocated) ? 1 : 0;
                  let assigned_excise_charge = (been_at_source || been_at_destination) ? limits.excise_charge / (2*(been_at_source+been_at_destination)) : limits.excise_charge;
                  let profit_per_trip = profit_each * quantity_per_trip;
                  let src_system = systems_data[active_supply_order.system_id];
                  let dest_systems = systems_data[active_demand_order.system_id];
                  // Assign values to the transaction object.
                  let transaction = {
                    source: {
                      location_id: active_supply_order.location_id,
                      system_id: active_supply_order.system_id,
                      region_id: active_supply_order.region_id,
                      system_name: systems_data[active_supply_order.system_id].name,
                      region_name: names_manifest[active_supply_order.region_id].name,
                      security_status: systems_data[active_supply_order.system_id].security_status
                    },
                    destination: {
                      location_id: active_demand_order.location_id,
                      system_id: active_demand_order.system_id,
                      region_id: active_demand_order.region_id,
                      system_name: systems_data[active_demand_order.system_id].name,
                      region_name: names_manifest[active_demand_order.region_id].name,
                      security_status: systems_data[active_demand_order.system_id].security_status
                    },
                    quantity: quantity,
                    price: {
                      supply: active_supply_order.price,
                      demand: active_demand_order.price
                    },
                    excise_charge: assigned_excise_charge,
                    profit_margin: profit_margin,
                    profit_total: profit_total,
                    investment: investment,
                    total_m3: total_m3,
                    round_trips: round_trips,
                    investment_per_trip: investment_per_trip,
                    profit_per_trip: profit_per_trip,
                    profit_per_m3: profit_per_m3
                  }

                  // Filter out the ones that aren't up to snuff
                  let up_to_snuff = false;
                  if(profit_per_trip - assigned_excise_charge >= limits.per_trip_profit){
                    let low_sec_transaction = (transaction.source.security_status < 0.5 || transaction.destination.security_status < 0.5);
                    if(low_sec_transaction && profit_margin >= limits.low_sec_margin) {
                      up_to_snuff = true;
                      transaction_log.push(`| Warning!!! Low-Security Transaction, ${currencyFormat(profit_per_trip)} ISK profit per trip.`);
                    }
                    if(!low_sec_transaction && profit_margin >= limits.per_trip_profit) {
                      up_to_snuff = true;
                      transaction_log.push(`high_sec transaction, ${currencyFormat(profit_per_trip)} ISK profit per trip.`);
                    }
                  }

                  //console.log(`up_to_snuff: ${up_to_snuff} | profit_per_trip: ${currencyFormat(profit_per_trip)} - assigned_excise_charge: ${currencyFormat(assigned_excise_charge)} - limits.per_trip_profit: ${currencyFormat(limits.per_trip_profit)} = ${currencyFormat(profit_per_trip - assigned_excise_charge - limits.per_trip_profit)}`);
                  if(up_to_snuff){
                    //console.log(`\t\t[demand] for ${transaction.quantity} [${active_demand_order.unallocated}] @ ${currencyFormat(transaction.price.demand)} from system_id: ${transaction.destination.system_id} in region_id: ${transaction.destination.region_id}`);

                    show_logs = true;
                    transactions.push(transaction);
                    transaction_log.push(`| Buy\t${numberFormat(0, transaction.quantity)} from ${transaction.source.system_name} [${transaction.source.region_name}] for ${currencyFormat(transaction.price.supply)}`);
                    transaction_log.push(`| Sell\t${numberFormat(0, transaction.quantity)} @ to ${transaction.destination.system_name} [${transaction.destination.region_name}] for ${currencyFormat(transaction.price.demand)}`);
                    transaction_log.push(`| ~ Profit Margin: ${percentageFormat(transaction.profit_margin)}\t\t| Profit/trip: ${currencyFormat(transaction.profit_per_trip)}`);
                    transaction_log.push(`| ~ Profit Total: ${currencyFormat(transaction.profit_total)}\t| Trips: ${transaction.round_trips}`);
                    transaction_log.push(`| ~ Load Cost: ${currencyFormat(transaction.investment_per_trip)}\t| Total m3: ${volumetricFormat(transaction.total_m3)}`);
                    transaction_log.push(`| ~ Supply (qty): ${numberFormat(0,active_supply_order.unallocated)}\t| Demand (qty): ${numberFormat(0,active_demand_order.unallocated)}\t| Profit/m3: ${currencyFormat(transaction.profit_per_m3)}`);
                    transaction_log.push("|---------------------------------------------------------------------------------------|");


                    active_supply_order.unallocated -=  quantity;
                    active_demand_order.unallocated -= quantity;
                    if(active_demand_order.unallocated > 0){
                      adndx--; // dial back one, to hit this again since it is not yet fully allocated.
                    }
                    if(active_supply_order.unallocated <= 0){
                      active_supply_order = profitable_supply.pop();  // Moves to the next supply order in line... out with the old.
                      if(typeof active_supply_order === 'undefined'){
                        //console.log(`\tEnd of the supplies for ${name}`);
                        //console.log("|---------------------------------------------------------------------------------------|");
                        adndx = profitable_demands.length  // leave the demand loop too if there isn't another supply to iterate through.
                      }
                    }
                  }
                }
              }
              active_supply_order = profitable_supply.shift();  // Moves to the next supply order in line... out with the old.
              if(typeof active_supply_order === 'undefined'){
                //console.log(`\tEnd of the supplies for ${name}`);
                //console.log("|---------------------------------------------------------------------------------------|");
              }
            }
            if(show_logs) {
              let tmp_countA = trading_manifest.length;
              let tmp_countB = transactions.length;
              trading_manifest = trading_manifest.concat(transactions);
              let tmp_countC = trading_manifest.length;
              //console.log(`!!!LOOK HERE!!!  ==>  adding ${tmp_countB} transactions to the existing ${tmp_countA} : Success?: ${((tmp_countA+tmp_countB==tmp_countC))}`);

              let log_line = transaction_log.shift();
              while(typeof log_line !== 'undefined'){
                console.log(log_line);
                log_line = transaction_log.shift();
              }
            }
          }
        }
      }
    } catch(err){
      console.error(err);
    } finally{

    }
  }
  /*
  for(ndx_b=0;ndx_b<market_manifest.length;ndx_b++){
    try{
      while(!market_manifest[ndx_b])ndx_b++;
      if(ndx_b>=market_manifest.length) break;
      let item_market = market_manifest[ndx_b];

      // Supply & Demand Check
      let supply = item_market.supply.length;
      let demand = item_market.demand.length;

      let highest_bid = await item_market.demand.reduce(return_highest_bid, Number.MIN_VALUE);
      let lowest_bid = await item_market.demand.reduce(return_lowest_price, Number.MAX_VALUE);
      let lowest_price = await item_market.supply.reduce(return_lowest_price, Number.MAX_VALUE);

      let type_id = item_market.type_id;
      if(!item_meta_manifest[type_id]) await replace_missing_type_data(type_id);
      let name = item_meta_manifest[type_id].name.en;
      let isBlueprint = name.indexOf('Blueprint')>-1;
      let isSKIN = name.indexOf('SKIN')>-1;
      let closeMargin = lowest_bid/highest_bid >= 0.8;
      let gameStaple = lowest_bid == highest_bid;
      if(!isSKIN && !isBlueprint && demand > 1 && closeMargin && !gameStaple){
        if(lowest_price == Number.MAX_VALUE) lowest_price = null;
        let profit = highest_bid-lowest_price;
        let basePrice = item_meta_manifest[type_id].basePrice;
        let profit_base = basePrice-lowest_price;
        let volume = item_meta_manifest[type_id].volume;
        let base_margin = profit_base/lowest_price;
        let profit_margin = profit/lowest_price;
        let transactions = [];
        let transaction_log = [];
        let show_logs = false;
        demand_manifest.push('');
        // sort to place best orders at the top... to be shifted off.
        await item_market.supply.sort(sort_supply_orders_by_price);
        await item_market.demand.sort(sort_demand_orders_by_price);
        let qty_param = 1000;
        demand_manifest.push("|---------------------------------------------------------------------------------------|");
        demand_manifest.push(`| [ ${type_id} ]\t ${name}`);
        demand_manifest.push(`| Volume: ${volumetricFormat(volume)}`);
        demand_manifest.push(`| ${qty_param || 1000} @ ${volumetricFormat(volume)} = ${volumetricFormat((qty_param || 1000) * volume)}`);
        demand_manifest.push("|---------------------------------------------------------------------------------------|");
        demand_manifest.push(`| Processing ${item_market.supply.length} supply & ${item_market.demand.length} demand orders`)
        demand_manifest.push(`| High Bid: ${currencyFormat(highest_bid)}`);
        if(basePrice) demand_manifest.push(`| Base Price: ${currencyFormat(basePrice)} | Profit (Base): ${currencyFormat(profit_base)}`);
        demand_manifest.push("|---------------------------------------------------------------------------------------|");
        demand_manifest.push('| [ Purchase Orders ]');
        for(dndx=0;dndx<item_market.demand.length;dndx++){
          let purchase_order = item_market.demand[dndx];
          //console.log(purchase_order);
          try{
            demand_manifest.push(`|\t${numberFormat(0, purchase_order.volume_remain)}   @   ${currencyFormat(purchase_order.price)}\tfrom\t${systems_data[purchase_order.system_id].name}\t[ ${names_manifest[purchase_order.region_id].name} ]`);
          } catch(err) {console.error(err);}
        }
        demand_manifest.push("|---------------------------------------------------------------------------------------|");
      }
    } catch(err){
      throw(err);
    } finally{

    }
  }
  */
  return;
}

async function create_report(){
  let manifest_timestamp = new Date().getTime();
  let writable_manifest = JSON.stringify(trading_manifest);
  console.log(`Profitable Transactions: ${trading_manifest.length}`);
  await fs.writeFile(`C:/Phox.Solutions/products/eve_trader/reports/trading_manifest ${manifest_timestamp}.json`,writable_manifest, async (err) => {
    if(err) throw err;
    console.log(`trading_manifest ${manifest_timestamp}.json  |  ${(err)?"Failed":"Successful!"}`);

    let dm_file = fs.createWriteStream(`C:/Phox.Solutions/products/eve_trader/reports/demand_manifest ${manifest_timestamp}.report`);
    await demand_manifest.forEach(async (d) => {
      dm_file.write(`${d}\n`);
    });
    dm_file.end();
    console.log(`demand_manifest ${manifest_timestamp}.json`);
    return;
  });
}

// ---- SUB-ROUTINE FUNCTIONS ------------------------------------------------//

async function insert_records(type_data){
  try{
    await eve_meta_database.insert(type_data, async (err, data) => {
        if(err) throw(err);
    });
  } catch(error) {
    throw(error);
  }
}

async function replace_missing_type_data(type_id){
  return new Promise(async (resolve, reject) => {
    let api_url = "https://esi.evetech.net/latest/universe/types/" + type_id + "/?datasource=tranquility&language=en-us";
    //console.log(api_url);
    await https.get(api_url, async (res) => {
      let data = '';
      res.on('data', (chunk) => {data += chunk});
      res.on('error', reject);
      res.on('end',async () => {
        //console.log(res.statusCode);
        if (res.statusCode >= 200 && res.statusCode <= 299) {
          let type_data = JSON.parse(data);
          let _n = type_data.name;
          type_data.name = {
            en: type_data.name
          }
          type_data._id = type_data.type_id.toString();
          //console.log(type_data);
          item_meta_manifest[type_data.type_id] = type_data;
          await insert_records(type_data);

          resolve();
        } else {
          reject('Request failed. status: ' + res.statusCode + ', body: ' + data);
        }
      });
    });
  });
}

function extract_type_ids(item){
    return(item.id);
}

function map_to_item_meta(item){
    if(item.doc.name.en){
      this[item.id] = item.doc;
    }
}

function map_to_systems(item){
  this[item.id] = item.value;
}

function map_to_names(item){
  this[item.id] = item.doc;
}

function map_to_market_manifest(item){
  this[item.doc.type_id] = item.doc;
}

function return_highest_bid(soFar, currOrder){
  return Math.max(soFar, currOrder.price);
}

function return_lowest_price(soFar, currOrder){
  return Math.min(soFar, currOrder.price);
}

function numberFormat(places, num) {
  return num.toFixed(places).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
}

function currencyFormat(num) {
  return num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + ' ISK';
}

function percentageFormat(num) {
  return (num*100).toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + '%';
}

function volumetricFormat(num){
  return num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,') + ' m3';
}

function filter_profitable_demands(demand){
  return (demand.price>this);
}

function filter_profitable_supplies(supply){
  return(supply.price<this);
}

function sort_supply_orders_by_price(a, b){
  return (a.price<b.price) ? -1 : (a.price>b.price) ? 1 : 0;
}

function sort_demand_orders_by_price(a, b){
  return (a.price<b.price) ? 1 : (a.price>b.price) ? -1 : 0;
}

// ---- SCRIPT LOGIC ---------------------------------------------------------//

init()
  .then(analyze_market_data)
  .then(create_report)
  .catch((error) => {throw(error)});
