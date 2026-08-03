import type { QueryInterface } from 'sequelize';
import { DataTypes } from 'sequelize';
type Params={context:QueryInterface};
export async function up({context:qi}:Params):Promise<void>{const transaction=await qi.sequelize.transaction();try{
  await qi.addColumn('inventory_movements','addon_id',{type:DataTypes.INTEGER,allowNull:true,references:{model:'addons',key:'id'}},{transaction});
  await qi.addColumn('inventory_movements','booking_id',{type:DataTypes.INTEGER,allowNull:true,references:{model:'bookings',key:'id'}},{transaction});
  await qi.addColumn('inventory_movements','incident_kind',{type:DataTypes.STRING(30),allowNull:true},{transaction});
  await qi.addIndex('inventory_movements',['incident_kind','date'],{name:'inventory_movements_incident_date_idx',transaction});
  await transaction.commit();
}catch(e){await transaction.rollback();throw e;}}
export async function down({context:qi}:Params):Promise<void>{const transaction=await qi.sequelize.transaction();try{await qi.removeColumn('inventory_movements','incident_kind',{transaction});await qi.removeColumn('inventory_movements','booking_id',{transaction});await qi.removeColumn('inventory_movements','addon_id',{transaction});await transaction.commit();}catch(e){await transaction.rollback();throw e;}}
