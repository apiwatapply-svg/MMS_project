const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
    const oees = await prisma.tb_oee.findMany({
        orderBy: { date: "desc" },
        take: 10
    });
    console.log(oees);
}
main().finally(() => prisma.$disconnect());
