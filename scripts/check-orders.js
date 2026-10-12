// Kiểm tra (và dọn nếu cần) dữ liệu đơn hàng cũ trước khi bật unique index.
//
//   node scripts/check-orders.js           → CHỈ ĐỌC, in báo cáo, không sửa gì
//   node scripts/check-orders.js --fix     → dọn trùng + tính lại số đơn / chi tiêu của khách
//
// Không xoá đơn nào: đơn trùng chỉ bị tách khỏi bình luận hoặc đổi mã đơn.
require('dotenv').config();
const mongoose = require('mongoose');
const { Order, Customer } = require('../backend/src/database');

const FIX = process.argv.includes('--fix');

async function findDuplicates(field) {
  return Order.aggregate([
    { $match: { [field]: { $type: field === 'commentId' ? 'objectId' : 'string' } } },
    // commentId là duy nhất toàn hệ thống; mã đơn chỉ cần duy nhất trong từng shop
    { $group: { _id: field === 'commentId' ? '$commentId' : { shop: '$shopId', n: '$orderNumber' }, ids: { $push: { id: '$_id', createdAt: '$createdAt', orderNumber: '$orderNumber' } }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Thiếu MONGODB_URI trong .env');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(FIX ? '== CHẾ ĐỘ SỬA (--fix) ==' : '== CHẾ ĐỘ CHỈ ĐỌC (thêm --fix để sửa) ==');

  // 1. Nhiều đơn cho cùng 1 bình luận
  const dupComments = await findDuplicates('commentId');
  console.log(`\n[1] Bình luận có nhiều hơn 1 đơn: ${dupComments.length}`);
  for (const d of dupComments) {
    const sorted = d.ids.sort((a, b) => a.createdAt - b.createdAt);
    const [keep, ...rest] = sorted;
    console.log(`   commentId ${d._id}: giữ ${keep.orderNumber}, tách ${rest.map(r => r.orderNumber).join(', ')}`);
    if (FIX) {
      // Đơn thừa vẫn giữ lại (thành đơn "tạo tay"), bạn tự huỷ nếu là đơn rác
      await Order.updateMany({ _id: { $in: rest.map(r => r.id) } }, { $set: { commentId: null } });
    }
  }

  // 2. Trùng mã đơn
  const dupNumbers = await findDuplicates('orderNumber');
  console.log(`\n[2] Mã đơn bị trùng: ${dupNumbers.length}`);
  for (const d of dupNumbers) {
    const sorted = d.ids.sort((a, b) => a.createdAt - b.createdAt);
    const [keep, ...rest] = sorted;
    console.log(`   ${d._id.n || d._id} (shop ${d._id.shop || '?'}): ${d.n} đơn — giữ đơn tạo sớm nhất, đổi mã các đơn còn lại thành ${d._id}-D2, -D3...`);
    if (FIX) {
      for (let i = 0; i < rest.length; i++) {
        await Order.updateOne({ _id: rest[i].id }, { $set: { orderNumber: `${keep.orderNumber}-D${i + 2}` } });
      }
    }
  }

  // 3. Số đơn / chi tiêu của khách so với đơn thực tế
  const actual = await Order.aggregate([
    { $group: {
      _id: { shop: '$shopId', u: '$tiktokUserId' },
      orders: { $sum: { $cond: [{ $ne: ['$status', 'cancelled'] }, 1, 0] } },
      spent:  { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$amount', 0] } },
    } },
  ]);
  const key = (shop, u) => `${shop}|${u}`;
  const byUser = new Map(actual.map(a => [key(a._id.shop, a._id.u), a]));
  const customers = await Customer.find().select('shopId tiktokUserId username totalOrders totalSpent').lean();
  const wrong = customers.filter(c => {
    const a = byUser.get(key(c.shopId, c.tiktokUserId)) || { orders: 0, spent: 0 };
    return (c.totalOrders || 0) !== a.orders || (c.totalSpent || 0) !== a.spent;
  });
  console.log(`\n[3] Khách có số đơn / chi tiêu lệch với đơn thực tế: ${wrong.length}/${customers.length}`);
  for (const c of wrong.slice(0, 20)) {
    const a = byUser.get(key(c.shopId, c.tiktokUserId)) || { orders: 0, spent: 0 };
    console.log(`   @${c.username}: số đơn ${c.totalOrders || 0} → ${a.orders}, chi tiêu ${c.totalSpent || 0} → ${a.spent}`);
  }
  if (wrong.length > 20) console.log(`   ... và ${wrong.length - 20} khách khác`);
  if (FIX && wrong.length) {
    await Customer.bulkWrite(wrong.map(c => {
      const a = byUser.get(key(c.shopId, c.tiktokUserId)) || { orders: 0, spent: 0 };
      return { updateOne: { filter: { _id: c._id }, update: { $set: { totalOrders: a.orders, totalSpent: a.spent } } } };
    }));
  }

  // 4. Tạo unique index — chỉ ở chế độ --fix (chế độ chỉ đọc không ghi gì vào DB)
  const clean = !dupComments.length && !dupNumbers.length;
  if (FIX) {
    await Order.createIndexes();
    console.log('\n[4] Đã tạo unique index cho Order.commentId và Order.orderNumber ✓');
  } else if (clean) {
    console.log('\n[4] Không có dữ liệu trùng ✓ — backend sẽ tự tạo unique index khi khởi động.');
  } else {
    console.log('\n[4] Còn dữ liệu trùng → chạy lại với --fix trước khi chạy backend.');
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('LỖI:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
